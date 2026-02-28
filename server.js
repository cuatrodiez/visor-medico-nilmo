require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Configuración Google Drive
const drive = google.drive({
    version: 'v3',
    auth: process.env.GOOGLE_API_KEY
});

// FUNCIÓN RECURSIVA CON EL FIX DE ANTIGRAVITY APLICADO
async function findDicomFiles(folderId, folderName) {
    let results = [];
    try {
        console.log(`🔎 Buscando en: ${folderName} (${folderId})`);
        
        const res = await drive.files.list({
            q: `'${folderId}' in parents and trashed = false`,
            fields: 'files(id, name, mimeType)',
            pageSize: 1000,
            // --- FIX ANTIGRAVITY ---
            supportsAllDrives: true, 
            includeItemsFromAllDrives: true
            // -----------------------
        });

        const files = res.data.files || [];
        
        const subFolders = files.filter(f => f.mimeType === 'application/vnd.google-apps.folder');
        const dicomFiles = files.filter(f => f.mimeType !== 'application/vnd.google-apps.folder');

        // Si encontramos archivos, los agregamos
        if (dicomFiles.length > 0) {
            console.log(`✅ Encontradas ${dicomFiles.length} imágenes en ${folderName}`);
            results.push({
                id: folderId,
                name: folderName, 
                series: [{
                    id: folderId,
                    name: 'Imágenes',
                    fileCount: dicomFiles.length,
                    files: dicomFiles.map(f => ({ id: f.id, name: f.name }))
                }]
            });
        }

        // Buscamos dentro de las subcarpetas (Recursividad)
        for (const folder of subFolders) {
            const deeperResults = await findDicomFiles(folder.id, folder.name);
            results = results.concat(deeperResults);
        }

    } catch (error) {
        console.error(`⚠️ Error en carpeta ${folderName}:`, error.message);
    }
    return results;
}

// API PRINCIPAL
app.get('/api/studies', async (req, res) => {
    console.log("📥 Iniciando escaneo...");
    try {
        const rootId = process.env.TARGET_FOLDER_ID;
        const studies = await findDicomFiles(rootId, "Raíz");
        res.json(studies);
    } catch (error) {
        console.error("Error Fatal:", error);
        res.status(500).json({ error: error.message });
    }
});

// API DESCARGA
app.get('/api/download/:fileId', async (req, res) => {
    try {
        const result = await drive.files.get({
            fileId: req.params.fileId,
            alt: 'media',
            // --- FIX TAMBIÉN AQUÍ ---
            supportsAllDrives: true 
        }, { responseType: 'stream' });
        
        result.data.pipe(res);
    } catch (error) {
        res.status(500).send("Error descarga");
    }
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Listo en puerto ${PORT}`));
