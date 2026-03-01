const express = require('express');
const { google } = require('googleapis');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 8080;
const HOST = '0.0.0.0';

// Configuración de Google Drive (Extraído de tu versión original)
const TARGET_FOLDER_ID = "1IG0pnmWv4lVTMlyOznP5dQOB2xQboxDW";
const GOOGLE_API_KEY = "AIzaSyCAfrixHasdfddUj3GEhZ20gsYDGKKHhVA";

const drive = google.drive({
  version: 'v3',
  auth: GOOGLE_API_KEY
});

// Cache en memoria
let cachedDicomSeries = null;
let isScanning = false;

/**
 * Función recursiva para mapear carpetas y archivos
 */
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

        // Filtros de exclusión de archivos no médicos
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

        // Validación de archivos DICOM por extensión o peso
        if (hasDcmExt || (hasNoExt && sizeBytes > 100 * 1024)) {
          imageIds.push(file.id);
        }
      }
    }

    if (imageIds.length > 0) {
      cachedDicomSeries[currentPath] = imageIds;
    }
  } catch (error) {
    console.error(`Error procesando carpeta ${currentPath}:`, error.message);
  }
}

/**
 * Orquestador del escaneo de la biblioteca
 */
async function refreshDicomCache() {
  if (isScanning) return;
  
  console.log("=== Iniciando sincronización con Google Drive ===");
  isScanning = true;
  const tempCache = {};
  
  try {
    const resList = await drive.files.list({
      q: `"${TARGET_FOLDER_ID}" in parents and trashed=false`,
      fields: 'files(id, name, mimeType)',
      pageSize: 100,
    });

    const rootItems = resList.data.files || [];
    
    // Ejecutamos el mapeo de cada volumen
    for (const item of rootItems) {
      if (item.mimeType === 'application/vnd.google-apps.folder') {
        console.log(`Mapeando volumen: ${item.name}`);
        cachedDicomSeries = cachedDicomSeries || {}; // Evita que la API devuelva null si alguien entra durante el proceso
        await traverseFolders(item.id, item.name);
      }
    }

    console.log("=== Sincronización completada con éxito ===");
  } catch (error) {
    console.error("Error crítico en la sincronización:", error.message);
  } finally {
    isScanning = false;
  }
}

// ENDPOINT: Obtener lista de estudios
app.get('/api/dicom-list', async (req, res) => {
  if (!cachedDicomSeries) {
    // Si la cache está vacía (primer arranque), forzamos una espera o devolvemos estado de carga
    await refreshDicomCache();
  }
  res.json(cachedDicomSeries || { "Cargando...": [] });
});

// ENDPOINT: Transmisión de archivo DICOM (Streaming)
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
      .on('error', err => {
        console.error('Error en el stream del archivo:', err.message);
        if (!res.headersSent) res.status(500).end();
      })
      .pipe(res);
  } catch (error) {
    console.error(`Error al obtener archivo ${fileId}:`, error.message);
    if (!res.headersSent) res.status(500).end();
  }
});

// Iniciar servidor y disparar el primer escaneo en segundo plano
app.listen(PORT, HOST, () => {
  console.log(`Servidor Nilmo DICOM corriendo en http://${HOST}:${PORT}`);
  
  // Disparar sincronización inicial sin bloquear el arranque del servidor
  refreshDicomCache().catch(console.error);
});
