require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();

// ✅ FIX #1: Leer PORT de Railway (Railway asigna el puerto dinámicamente)
const PORT = process.env.PORT || 8080;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const TARGET_FOLDER_ID = process.env.TARGET_FOLDER_ID;

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// ✅ FIX #2: Usar fetch directo a la API REST de Google Drive con API Key
// (La librería googleapis con auth por API Key tiene bugs en Railway)
const DRIVE_API = 'https://www.googleapis.com/drive/v3';

async function getFilesInFolder(folderId) {
    let allFiles = [];
    let pageToken = null;

    do {
        let url = `${DRIVE_API}/files?q='${folderId}'+in+parents+and+trashed=false&fields=nextPageToken,files(id,name,mimeType)&key=${GOOGLE_API_KEY}&supportsAllDrives=true&includeItemsFromAllDrives=true&pageSize=1000`;
        if (pageToken) url += `&pageToken=${pageToken}`;

        const res = await fetch(url);

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Google Drive API error: ${res.status} - ${errText}`);
        }

        const data = await res.json();

        if (data.files) {
            allFiles = allFiles.concat(data.files);
        }
        pageToken = data.nextPageToken || null;
    } while (pageToken);

    return allFiles;
}

// ✅ API: Listar estudios y series
app.get('/api/studies', async (req, res) => {
    try {
        if (!TARGET_FOLDER_ID) throw new Error("TARGET_FOLDER_ID no configurado en Railway Variables");
        if (!GOOGLE_API_KEY) throw new Error("GOOGLE_API_KEY no configurada en Railway Variables");

        const mainFiles = await getFilesInFolder(TARGET_FOLDER_ID);
        let result = [];
        const studyFolders = mainFiles.filter(f => f.mimeType === 'application/vnd.google-apps.folder');

        if (studyFolders.length > 0) {
            for (const studyFolder of studyFolders) {
                const studyData = {
                    id: studyFolder.id,
                    name: studyFolder.name,
                    series: []
                };

                const studyContents = await getFilesInFolder(studyFolder.id);
                const seriesFolders = studyContents.filter(f => f.mimeType === 'application/vnd.google-apps.folder');

                if (seriesFolders.length > 0) {
                    for (const s of seriesFolders) {
                        const seriesFiles = await getFilesInFolder(s.id);
                        const dicomFiles = seriesFiles.filter(f =>
                            f.mimeType !== 'application/vnd.google-apps.folder' &&
                            f.name !== 'DICOMDIR' &&
                            !f.name.startsWith('.')
                        );
                        if (dicomFiles.length > 0) {
                            studyData.series.push({
                                id: s.id,
                                name: s.name,
                                fileCount: dicomFiles.length,
                                files: dicomFiles
                                    .map(df => ({ id: df.id, name: df.name }))
                                    .sort((a, b) => a.name.localeCompare(b.name))
                            });
                        }
                    }
                } else {
                    // La carpeta de estudio contiene archivos directamente (es la serie)
                    const dicomFiles = studyContents.filter(f =>
                        f.mimeType !== 'application/vnd.google-apps.folder' &&
                        f.name !== 'DICOMDIR' &&
                        !f.name.startsWith('.')
                    );
                    if (dicomFiles.length > 0) {
                        studyData.series.push({
                            id: studyFolder.id,
                            name: 'Imágenes',
                            fileCount: dicomFiles.length,
                            files: dicomFiles
                                .map(df => ({ id: df.id, name: df.name }))
                                .sort((a, b) => a.name.localeCompare(b.name))
                        });
                    }
                }

                if (studyData.series.length > 0) {
                    result.push(studyData);
                }
            }
        } else {
            // La carpeta raíz tiene archivos directamente
            const dicomFiles = mainFiles.filter(f =>
                f.mimeType !== 'application/vnd.google-apps.folder' &&
                f.name !== 'DICOMDIR' &&
                !f.name.startsWith('.')
            );
            if (dicomFiles.length > 0) {
                result.push({
                    id: TARGET_FOLDER_ID,
                    name: 'Estudio Principal',
                    series: [{
                        id: TARGET_FOLDER_ID,
                        name: 'Serie Principal',
                        fileCount: dicomFiles.length,
                        files: dicomFiles
                            .map(df => ({ id: df.id, name: df.name }))
                            .sort((a, b) => a.name.localeCompare(b.name))
                    }]
                });
            }
        }

        res.json(result);
    } catch (error) {
        console.error("Error fetching studies:", error.message);
        res.status(500).json({ error: error.message });
    }
});

// ✅ API: Proxy para descargar/streamear archivos DICOM
app.get('/api/download/:fileId', async (req, res) => {
    try {
        const fileId = req.params.fileId;
        const url = `${DRIVE_API}/files/${fileId}?alt=media&key=${GOOGLE_API_KEY}`;

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`Error descargando archivo: ${response.status}`);
        }

        res.setHeader('Content-Type', 'application/dicom');
        res.setHeader('Access-Control-Allow-Origin', '*');

        // Stream directo sin cargar en memoria
        const reader = response.body.getReader();
        const pump = async () => {
            const { done, value } = await reader.read();
            if (done) {
                res.end();
                return;
            }
            res.write(Buffer.from(value));
            return pump();
        };
        await pump();

    } catch (error) {
        console.error("Error streaming file:", error.message);
        res.status(500).send("Error al descargar el archivo DICOM");
    }
});

// ✅ Health check para Railway
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        port: PORT,
        targetFolder: TARGET_FOLDER_ID ? '✅ configurado' : '❌ falta TARGET_FOLDER_ID',
        apiKey: GOOGLE_API_KEY ? '✅ configurada' : '❌ falta GOOGLE_API_KEY'
    });
});

// ✅ FIX PRINCIPAL: '0.0.0.0' permite que Railway enrute tráfico externo al proceso
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Servidor DICOM corriendo en puerto ${PORT}`);
    console.log(`📁 TARGET_FOLDER_ID: ${TARGET_FOLDER_ID || '❌ NO CONFIGURADO'}`);
    console.log(`🔑 GOOGLE_API_KEY: ${GOOGLE_API_KEY ? '✅ OK' : '❌ NO CONFIGURADA'}`);
});
