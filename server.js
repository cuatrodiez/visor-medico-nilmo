require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Configuración robusta de Google Drive
const drive = google.drive({
    version: 'v3',
    auth: process.env.GOOGLE_API_KEY
});

// FUNCIÓN "BUSCADOR PROFUNDO" (La solución al problema)
// Busca imágenes sin importar si están en CD1, en subcarpetas o sueltas.
async function findDicomFiles(folderId, folderName) {
    let results = [];
    try {
        const res = await drive.files.list({
            q: `'${folderId}' in parents and trashed = false`,
            fields: 'files(id, name, mimeType)',
            pageSize: 1000
        });

        const files = res.data.files || [];
        
        // Separar lo que es carpeta de lo que es archivo
        const subFolders = files.filter(f => f.mimeType === 'application/vnd.google-apps.folder');
        const dicomFiles = files.filter(f => f.mimeType !== 'application/vnd.google-apps.folder');

        // 1. Si encontramos archivos aquí, ¡los guardamos!
        if (dicomFiles.length > 0) {
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

        // 2. Si hay más carpetas, entramos a investigar (Recursividad)
        for (const folder of subFolders) {
            const deeperResults = await findDicomFiles(folder.id, folder.name);
            results = results.concat(deeperResults);
        }

    } catch (error) {
        console.error(`Saltando carpeta ${folderName} por permisos o error.`);
    }
    return results;
}

// API PRINCIPAL
app.get('/api/studies', async (req, res) => {
    console.log("📥 Iniciando escaneo profundo de Drive...");
    try {
        const rootId = process.env.TARGET_FOLDER_ID;
        if (!rootId) throw new Error("Falta el ID de la carpeta");

        const studies = await findDicomFiles(rootId, "Raíz");
        
        console.log(`✅ Encontradas ${studies.length} carpetas con imágenes.`);
        res.json(studies);
    } catch (error) {
        console.error("Error grave:", error);
        res.status(500).json({ error: error.message });
    }
});

// API DESCARGA (Igual que antes, funciona bien)
app.get('/api/download/:fileId', async (req, res) => {
    try {
        const result = await drive.files.get({
            fileId: req.params.fileId,
            alt: 'media'
        }, { responseType: 'stream' });
        
        result.data.pipe(res);
    } catch (error) {
        res.status(500).send("Error de descarga");
    }
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Servidor listo en puerto ${PORT}`));
