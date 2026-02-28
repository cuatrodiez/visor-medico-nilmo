require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// === DATOS DE CONEXIÓN EXACTOS ===
const TARGET_FOLDER_ID = "1IG0pnmWv4lVTMlyOznP5dQOB2xQboxDW";
const GOOGLE_API_KEY = "AIzaSyCAfrixHasdfddUj3GEhZ20gsYDGKKHhVA";

// Inicializando Cliente de Google Drive directamente con API_KEY
const drive = google.drive({
    version: 'v3',
    auth: GOOGLE_API_KEY
});

// === FUNCIÓN RECURSIVA PARA ENCONTRAR TODOS LOS ARCHIVOS ===
// Entrará en "CD1", "CD2", y subcarpetas infinitamente si existen
async function findDicomFiles(folderId) {
    let files = [];
    try {
        // En drive.files.list están de forma obligatoria los supportsAllDrives
        const res = await drive.files.list({
            q: `'${folderId}' in parents and trashed = false`,
            fields: 'files(id, name, mimeType)',
            supportsAllDrives: true,                 // OBLIGATORIO
            includeItemsFromAllDrives: true,          // OBLIGATORIO
            pageSize: 1000
        });

        const items = res.data.files;
        if (!items || items.length === 0) return files;

        for (const item of items) {
            if (item.mimeType === 'application/vnd.google-apps.folder') {
                // Es una subcarpeta: Llamada recursiva
                const subFolderFiles = await findDicomFiles(item.id);
                files = files.concat(subFolderFiles);
            } else {
                // Es un archivo: Lo guardamos
                files.push(item);
            }
        }
    } catch (error) {
        console.error(`Error buscando en la subcarpeta ${folderId}:`, error.message);
    }
    return files;
}

// Endpoint para traer toda la jerarquía al Frontend
app.get('/api/dicom-files', async (req, res) => {
    try {
        console.log('Iniciando rastreo recursivo en:', TARGET_FOLDER_ID);
        const allFiles = await findDicomFiles(TARGET_FOLDER_ID);
        res.json({ success: true, files: allFiles });
    } catch (error) {
        console.error('Error in /api/dicom-files:', error);
        res.status(500).json({ success: false, error: 'Error del servidor' });
    }
});

// Endpoint proxy para descargar binariamente y evitar CORS
app.get('/api/dicom-file/:fileId', async (req, res) => {
    try {
        const fileId = req.params.fileId;
        
        // En drive.files.get están de forma obligatoria los supportsAllDrives
        const response = await drive.files.get({
            fileId: fileId,
            alt: 'media',
            supportsAllDrives: true,                 // OBLIGATORIO
            includeItemsFromAllDrives: true          // OBLIGATORIO
        }, { responseType: 'stream' });
        
        // Pipe directo hacia el cliente con cabeceras CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
        response.data
            .on('end', () => {})
            .on('error', err => {
                console.error('Error descargando desde Google Drive:', err);
                res.status(500).send('Error downloading file');
            })
            .pipe(res);
            
    } catch (error) {
        console.error(`Error en proxy para fileId ${req.params.fileId}:`, error.message);
        res.status(500).send('Error haciendo proxy del archivo DICOM.');
    }
});

// SPA fallback
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`🚀 Visor médico corriendo en el puerto ${PORT}`));


