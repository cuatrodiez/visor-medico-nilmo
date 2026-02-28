document.addEventListener('DOMContentLoaded', () => {
    initCornerstone();
    fetchStudies();
    setupToolButtons();
    setupStackControls();
});

let currentStack = {
    imageIds: [],
    currentImageIdIndex: 0
};
let globalData = [];

function initCornerstone() {
    // 1. Initialize cornerstoneWADOImageLoader
    cornerstoneWADOImageLoader.external.cornerstone = cornerstone;
    cornerstoneWADOImageLoader.external.dicomParser = dicomParser;

    // Configure web workers for decoding
    cornerstoneWADOImageLoader.webWorkerManager.initialize({
        maxWebWorkers: navigator.hardwareConcurrency || 1,
        startWebWorkersOnDemand: true,
        taskConfiguration: {
            decodeTask: {
                initializeCodecsOnStartup: false,
                usePDFJS: false,
                strict: false,
            }
        }
    });

    // 2. Initialize cornerstoneTools
    cornerstoneTools.external.cornerstone = cornerstone;
    cornerstoneTools.external.Hammer = window.Hammer;
    cornerstoneTools.external.cornerstoneMath = cornerstoneMath;

    cornerstoneTools.init({
        showSVGCursors: true,
    });

    const element = document.getElementById('dicom-viewport');
    cornerstone.enable(element);

    // 3. Add tools
    const WwwcTool = cornerstoneTools.WwwcTool;
    const ZoomTool = cornerstoneTools.ZoomTool;
    const PanTool = cornerstoneTools.PanTool;
    const LengthTool = cornerstoneTools.LengthTool;
    const StackScrollMouseWheelTool = cornerstoneTools.StackScrollMouseWheelTool;

    cornerstoneTools.addTool(WwwcTool);
    cornerstoneTools.addTool(ZoomTool);
    cornerstoneTools.addTool(PanTool);
    cornerstoneTools.addTool(LengthTool);
    cornerstoneTools.addTool(StackScrollMouseWheelTool);

    // Set Wwwc as the default active tool
    cornerstoneTools.setToolActive('Wwwc', { mouseButtonMask: 1 });
    cornerstoneTools.setToolActive('Zoom', { mouseButtonMask: 2 }); // Right click
    cornerstoneTools.setToolActive('Pan', { mouseButtonMask: 4 }); // Middle click
    cornerstoneTools.setToolActive('StackScrollMouseWheel', {});

    // 4. Update overlays on render
    element.addEventListener('cornerstoneimagerendered', onImageRendered);
}

function onImageRendered(e) {
    const eventData = e.detail;
    const viewport = eventData.viewport;

    document.getElementById('window-level-overlay').textContent =
        `WL: ${Math.round(viewport.voi.windowCenter)} / WW: ${Math.round(viewport.voi.windowWidth)}`;

    document.getElementById('zoom-overlay').textContent =
        `Zoom: ${viewport.scale.toFixed(2)}x`;
}

function updateImageInfo() {
    if (currentStack.imageIds.length > 0) {
        document.getElementById('image-info').textContent =
            `Image: ${currentStack.currentImageIdIndex + 1} / ${currentStack.imageIds.length}`;
    } else {
        document.getElementById('image-info').textContent = `Image: 0 / 0`;
    }
}

async function fetchStudies() {
    try {
        const response = await fetch('/api/studies');
        if (!response.ok) throw new Error("Failed to fetch studies");
        const data = await response.json();
        globalData = data;
        renderSidebar(data);

        // Zero-Click Logic: If data exists, auto-load the very first series
        // Wait briefly for UI to render
        setTimeout(() => {
            if (data.length > 0 && data[0].series && data[0].series.length > 0) {
                loadSeries(data[0].series[0]);
            }
        }, 100);

    } catch (error) {
        console.error(error);
        document.getElementById('series-list').innerHTML = `<div class="loading-text" style="color: var(--danger)">Error loading studies from backend...</div>`;
    }
}

function renderSidebar(studies) {
    const list = document.getElementById('series-list');
    list.innerHTML = '';

    if (studies.length === 0) {
        list.innerHTML = `<div class="loading-text">No studies found in Drive folder</div>`;
        return;
    }

    studies.forEach(study => {
        const group = document.createElement('div');
        group.className = 'study-group';

        const title = document.createElement('div');
        title.className = 'study-title';
        title.textContent = study.name;
        group.appendChild(title);

        study.series.forEach(series => {
            const item = document.createElement('div');
            item.className = 'series-item';
            item.innerHTML = `
                <div class="series-name">${series.name}</div>
                <div class="series-meta">${series.fileCount} images</div>
            `;
            item.addEventListener('click', () => {
                document.querySelectorAll('.series-item').forEach(el => el.classList.remove('active'));
                item.classList.add('active');
                loadSeries(series);
            });
            group.appendChild(item);
        });

        list.appendChild(group);
    });

    // Set first item as visually active initially
    setTimeout(() => {
        const first = document.querySelector('.series-item');
        if (first) first.classList.add('active');
    }, 100);
}

async function loadSeries(series) {
    const element = document.getElementById('dicom-viewport');

    // Remove listeners to prevent memory drag
    element.removeEventListener('cornerstonenewimage', onNewImage);

    // Construct wadouri URLs for the backend proxy
    const imageIds = series.files.map(f => `wadouri:${window.location.origin}/api/download/${f.id}`);

    if (imageIds.length === 0) return;

    currentStack = {
        imageIds: imageIds,
        currentImageIdIndex: 0 // Start at beginning or Math.floor(imageIds.length / 2)
    };

    cornerstone.clearToolState(element, 'stack');
    cornerstoneTools.addStackStateManager(element, ['stack']);
    cornerstoneTools.addToolState(element, 'stack', currentStack);

    try {
        // Load the initial image
        const imageId = currentStack.imageIds[currentStack.currentImageIdIndex];
        const image = await cornerstone.loadImage(imageId);
        cornerstone.displayImage(element, image);

        updateImageInfo();

        // Listen for new image event to update UI text on scroll
        element.addEventListener('cornerstonenewimage', onNewImage);

    } catch (err) {
        console.error("Error loading image:", err);
        alert("Error loading the DICOM image initially.");
    }
}

function onNewImage(e) {
    const eventData = e.detail;
    currentStack.currentImageIdIndex = currentStack.imageIds.indexOf(eventData.image.imageId);
    updateImageInfo();
}

function setupToolButtons() {
    const buttons = document.querySelectorAll('.tool-btn');
    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            const toolName = btn.getAttribute('data-tool');

            // Set all primary tools to passive first
            cornerstoneTools.setToolPassive('Wwwc');
            cornerstoneTools.setToolPassive('Zoom');
            cornerstoneTools.setToolPassive('Pan');
            cornerstoneTools.setToolPassive('Length');

            // Set the clicked tool as active
            cornerstoneTools.setToolActive(toolName, { mouseButtonMask: 1 });

            // Update UI
            buttons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });
}

function setupStackControls() {
    const element = document.getElementById('dicom-viewport');

    document.getElementById('prev-btn').addEventListener('click', () => {
        if (currentStack.imageIds.length > 0 && currentStack.currentImageIdIndex > 0) {
            cornerstone.loadAndCacheImage(currentStack.imageIds[currentStack.currentImageIdIndex - 1]).then(image => {
                cornerstone.displayImage(element, image);
            });
        }
    });

    document.getElementById('next-btn').addEventListener('click', () => {
        if (currentStack.imageIds.length > 0 && currentStack.currentImageIdIndex < currentStack.imageIds.length - 1) {
            cornerstone.loadAndCacheImage(currentStack.imageIds[currentStack.currentImageIdIndex + 1]).then(image => {
                cornerstone.displayImage(element, image);
            });
        }
    });
}
