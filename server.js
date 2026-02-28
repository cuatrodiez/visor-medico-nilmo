require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { google } = require('googleapis'); // Usaremos la librería oficial, es más robusta

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Configuración de Google Drive
const drive = google.drive({
    version: 'v3',
    auth: process.env.GOOGLE_API_KEY // Usamos tu API Key
});

// Función recursiva para buscar archivos DICOM en todas las subcarpetas
async function findDicomFiles(folderId, folderName) {
    let results = [];
    try {
        // 1. Buscar archivos y carpetas en este nivel
        const res = await drive.files.list({
            q: `'${folderId}' in parents and trashed = false`,
            fields: 'files(id, name, mimeType)',
            pageSize: 1000
        });

        const files = res.data.files;
        if (!files || files.length === 0) return [];

        // Separar carpetas de archivos
        const subFolders = files.filter(f => f.mimeType === 'application/vnd.google-apps.folder');
        const dicomFiles = files.filter(f => f.mimeType !== 'application/vnd.google-apps.folder');

        // Si hay archivos aquí, crear una "Serie"
        if (dicomFiles.length > 0) {
            results.push({
                id: folderId,
                name: folderName, // Nombre de la carpeta actual (ej: CD1)
                series: [{
                    id: folderId,
                    name: 'Imágenes',
                    fileCount: dicomFiles.length,
                    files: dicomFiles.map(f => ({ id: f.id, name: f.name }))
                }]
            });
        }

        // 2. Buscar recursivamente en subcarpetas (ej: CD1/Imágenes)
        for (const folder of subFolders) {
            const subResults = await findDicomFiles(folder.id, folder.name);
            results = results.concat(subResults);
        }

    } catch (error) {
        console.error(`Error leyendo carpeta ${folderName}:`, error.message);
    }
    return results;
}

// API: Listar estudios (Búsqueda profunda)
app.get('/api/studies', async (req, res) => {
    console.log("📥 Petición recibida: Escaneando Drive...");
    try {
        const rootFolderId = process.env.TARGET_FOLDER_ID;
        if (!rootFolderId) throw new Error("Falta TARGET_FOLDER_ID");

        // Iniciar búsqueda recursiva desde la raíz
        const allStudies = await findDicomFiles(rootFolderId, "Raíz");
        
        console.log(`✅ Encontrados ${allStudies.length} grupos de imágenes.`);
        res.json(allStudies);
    } catch (error) {
        console.error("Error fatal:", error);
        res.status(500).json({ error: error.message });
    }
});

// API: Descargar archivo (Igual que antes, funciona bien)
app.get('/api/download/:fileId', async (req, res) => {
    try {
        const fileId = req.params.fileId;
        const result = await drive.files.get({
            fileId: fileId,
            alt: 'media'
        }, { responseType: 'stream' });

        result.data
            .on('end', () => res.end())
            .on('error', err => res.status(500).send(err))
            .pipe(res);
    } catch (error) {
        res.status(500).send("Error descargando archivo");
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Servidor listo en puerto ${PORT}`);
});
