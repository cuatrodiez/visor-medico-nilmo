require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.static('public'));

// Configure Google Drive API
let auth;
if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    auth = new google.auth.GoogleAuth({
        keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
        scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });
} else if (process.env.GOOGLE_API_KEY) {
    auth = process.env.GOOGLE_API_KEY;
} else {
    console.warn("WARNING: No Google Authentication configured. Please set GOOGLE_API_KEY or GOOGLE_APPLICATION_CREDENTIALS in .env");
}

const drive = google.drive({ version: 'v3', auth });
const TARGET_FOLDER_ID = process.env.TARGET_FOLDER_ID;

// Helper function to recursively get files in a folder
async function getFilesInFolder(folderId) {
    let allFiles = [];
    let pageToken = null;

    do {
        const res = await drive.files.list({
            q: `'${folderId}' in parents and trashed = false`,
            fields: 'nextPageToken, files(id, name, mimeType)',
            pageToken: pageToken,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true
        });

        const files = res.data.files;
        if (files) {
            allFiles = allFiles.concat(files);
        }
        pageToken = res.data.nextPageToken;
    } while (pageToken);

    return allFiles;
}

// Recursively find series (folders containing dicom files)
async function extractMetadata(folderId) {
    const files = await getFilesInFolder(folderId);
    let folders = [];
    let dicomFiles = [];
    
    for (const file of files) {
        if (file.mimeType === 'application/vnd.google-apps.folder') {
            folders.push(file);
        } else {
            // Assume files inside series folders are DICOMs or DICOMDIR.
            if (file.name !== 'DICOMDIR' && !file.name.startsWith('.')) {
                dicomFiles.push(file);
            }
        }
    }
    
    return { folders, dicomFiles };
}

app.get('/api/studies', async (req, res) => {
    try {
        if (!TARGET_FOLDER_ID) throw new Error("TARGET_FOLDER_ID is not configured");
        
        // 1. Get the main folder contents (could be studies or files directly)
        const mainFiles = await getFilesInFolder(TARGET_FOLDER_ID);
        
        // We assume the structure is: [Main Folder] -> [Study Folders] -> [Series Folders] -> [DICOM files]
        // Example: Nilmo -> TAC -> images...
        // Or Nilmo -> Cerebro Rutina -> images...
        
        let result = [];
        const studyFolders = mainFiles.filter(f => f.mimeType === 'application/vnd.google-apps.folder');
        
        if (studyFolders.length > 0) {
            for (const studyFolder of studyFolders) {
                const studyData = {
                    id: studyFolder.id,
                    name: studyFolder.name,
                    series: []
                };
                
                // Inside study folder, are there sub-folders (series) or just files?
                const studyContents = await getFilesInFolder(studyFolder.id);
                const seriesFolders = studyContents.filter(f => f.mimeType === 'application/vnd.google-apps.folder');
                
                if (seriesFolders.length > 0) {
                    for (const s of seriesFolders) {
                        const { dicomFiles } = await extractMetadata(s.id);
                        if (dicomFiles.length > 0) {
                            studyData.series.push({
                                id: s.id,
                                name: s.name,
                                fileCount: dicomFiles.length,
                                files: dicomFiles.map(df => ({ id: df.id, name: df.name })).sort((a,b) => a.name.localeCompare(b.name))
                            });
                        }
                    }
                } else {
                    // It's a series folder directly
                    const dicomFiles = studyContents.filter(f => f.mimeType !== 'application/vnd.google-apps.folder' && f.name !== 'DICOMDIR');
                    if (dicomFiles.length > 0) {
                        studyData.series.push({
                            id: studyFolder.id,
                            name: 'Images',
                            fileCount: dicomFiles.length,
                            files: dicomFiles.map(df => ({ id: df.id, name: df.name })).sort((a,b) => a.name.localeCompare(b.name))
                        });
                    }
                }
                
                if (studyData.series.length > 0) {
                    result.push(studyData);
                }
            }
        } else {
            // Main folder just has files
            const dicomFiles = mainFiles.filter(f => f.mimeType !== 'application/vnd.google-apps.folder' && f.name !== 'DICOMDIR');
            if (dicomFiles.length > 0) {
                result.push({
                    id: TARGET_FOLDER_ID,
                    name: 'Root Study',
                    series: [{
                        id: TARGET_FOLDER_ID,
                        name: 'Main Series',
                        fileCount: dicomFiles.length,
                        files: dicomFiles.map(df => ({ id: df.id, name: df.name })).sort((a,b) => a.name.localeCompare(b.name))
                    }]
                });
            }
        }
        
        res.json(result);
    } catch (error) {
        console.error("Error fetching studies:", error);
        res.status(500).json({ error: error.message });
    }
});

// Endpoint to proxy DICOM files
app.get('/api/download/:fileId', async (req, res) => {
    try {
        const fileId = req.params.fileId;
        const response = await drive.files.get(
            { fileId: fileId, alt: 'media' },
            { responseType: 'stream' }
        );
        
        res.setHeader('Content-Type', 'application/dicom');
        response.data.pipe(res);
    } catch (error) {
        console.error("Error streaming file:", error);
        res.status(500).send("Error streaming file");
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
