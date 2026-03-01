const express = require('express');
const { google } = require('googleapis');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 8080;
const HOST = '0.0.0.0';

const TARGET_FOLDER_ID = "1IG0pnmWv4lVTMlyOznP5dQOB2xQboxDW";
const GOOGLE_API_KEY = "AIzaSyCAfrixHasdfddUj3GEhZ20gsYDGKKHhVA";

const drive = google.drive({
  version: 'v3',
  auth: GOOGLE_API_KEY
});

// En memoria agrupado por nombre de carpeta
let cachedDicomSeries = null;

async function traverseFolders(folderId, currentPath) {
  const query = `"${folderId}" in parents and trashed=false`;

  try {
    const res = await drive.files.list({
      q: query,
      fields: 'files(id, name, mimeType, size)',
      pageSize: 1000,
    });

    const files = res.data.files || [];
    let imageIds = [];

    for (const file of files) {
      if (file.mimeType === 'application/vnd.google-apps.folder') {
        const newPath = currentPath + ' / ' + file.name;
        await traverseFolders(file.id, newPath);
      } else {
        const nameLower = file.name.toLowerCase();

        // Ignorar meta-archivos del visor quemado en CD
        if (
          nameLower === 'liteviewer64.exe' ||
          nameLower === 'autorun.inf' ||
          nameLower === 'dicomdir' ||
          nameLower.endsWith('.ini') ||
          nameLower.endsWith('.txt')
        ) {
          continue;
        }

        const sizeBytes = parseInt(file.size || '0', 10);
        const hasDcmExt = nameLower.endsWith('.dcm');
        const hasNoExt = !file.name.includes('.');

        // Solo recolecte los archivos de imagen (.dcm o sin extensión que pesen > 100kb)
        if (hasDcmExt || (hasNoExt && sizeBytes > 100 * 1024)) {
          imageIds.push(file.id);
        }
      }
    }

    if (imageIds.length > 0) {
      cachedDicomSeries[currentPath] = imageIds;
    }
  } catch (error) {
    console.error(`Error procesando la carpeta ${currentPath}:`, error.message);
  }
}

app.get('/api/dicom-list', async (req, res) => {
  try {
    if (!cachedDicomSeries) {
      console.log("Mapeando estructura base en Google Drive...");
      cachedDicomSeries = {};
      const query = `"${TARGET_FOLDER_ID}" in parents and trashed=false`;

      const resList = await drive.files.list({
        q: query,
        fields: 'files(id, name, mimeType)',
        pageSize: 100,
      });

      const rootItems = resList.data.files || [];
      for (const item of rootItems) {
        if (item.mimeType === 'application/vnd.google-apps.folder') {
          console.log(`Procesando volumen: ${item.name}`);
          await traverseFolders(item.id, item.name);
        }
      }

      // Ordenar alfabéticamente
      const sortedSeries = {};
      Object.keys(cachedDicomSeries).sort().forEach(key => {
        sortedSeries[key] = cachedDicomSeries[key];
      });
      cachedDicomSeries = sortedSeries;
    }
    res.json(cachedDicomSeries);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch file list' });
  }
});

app.get('/api/view/:id', async (req, res) => {
  const fileId = req.params.id;
  try {
    const driveRes = await drive.files.get(
      { fileId: fileId, alt: 'media' },
      { responseType: 'stream' }
    );

    res.setHeader('Content-Type', 'application/dicom');
    res.setHeader('Access-Control-Allow-Origin', '*');

    driveRes.data
      .on('end', () => { })
      .on('error', err => {
        console.error('Error streaming file:', err.message);
        if (!res.headersSent) res.status(500).end();
      })
      .pipe(res);
  } catch (error) {
    console.error(`Error fetching file content ${fileId}:`, error.message);
    if (!res.headersSent) res.status(500).end();
  }
});

app.listen(PORT, HOST, () => {
  console.log(`Nilmo DICOM viewer server is running on http://${HOST}:${PORT}`);
});
