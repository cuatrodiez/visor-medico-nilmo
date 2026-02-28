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

// En memoria para evitar llamadas redundantes a la request recursiva
let cachedDicomFiles = null;

async function getAllDicomFiles(folderId) {
  let allFiles = [];
  const query = `"${folderId}" in parents and trashed=false`;
  
  try {
    const res = await drive.files.list({
      q: query,
      fields: 'files(id, name, mimeType, size)',
      pageSize: 1000,
    });
    
    const files = res.data.files || [];
    
    for (const file of files) {
      if (file.mimeType === 'application/vnd.google-apps.folder') {
        const subFiles = await getAllDicomFiles(file.id);
        allFiles = allFiles.concat(subFiles);
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
          allFiles.push(file.id);
        }
      }
    }
  } catch (error) {
    console.error(`Error fetching files from folder ${folderId}:`, error.message);
  }
  
  return allFiles;
}

app.get('/api/dicom-list', async (req, res) => {
  try {
    if (!cachedDicomFiles) {
        console.log("Fetching DICOM list from Google Drive...");
        cachedDicomFiles = await getAllDicomFiles(TARGET_FOLDER_ID);
        console.log(`Found ${cachedDicomFiles.length} DICOM images.`);
    }
    res.json(cachedDicomFiles);
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
      .on('end', () => {})
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
