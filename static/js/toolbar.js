const toolbar = document.getElementById('bl-toolbar')
const zoomin = toolbar.querySelector('.btn-zoom-in')
const zoomout = toolbar.querySelector('.btn-zoom-out')
const savebtn = toolbar.querySelector('.save')
const centerbtn = toolbar.querySelector('.center')
const focusbtn = toolbar.querySelector('.focus')
const layoutbtn = toolbar.querySelector('.layout')
const wipebtn = toolbar.querySelector('.wipe')

function zoom(delta) {
    let newZoom = camera.zoom + delta;
    newZoom = Math.max(0.1, Math.min(newZoom, 3));
    newZoom = Math.round((newZoom*100))/100
    toolbar.querySelector('.zoomlevel').setAttribute('value', Math.round(newZoom*10)*10)

    const rect = viewport.getBoundingClientRect();
    const activeNode = nodes.find(n => n.id === activeNodeId)
    const mouseX = window.innerWidth/2;
    const mouseY = window.innerHeight/2;

    camera.x = mouseX - (mouseX - camera.x) * (newZoom / camera.zoom);
    camera.y = mouseY - (mouseY - camera.y) * (newZoom / camera.zoom);
    camera.zoom = newZoom;

    updateCanvas();
}

zoomin.addEventListener('mouseup', () => {zoom(0.1)})
zoomout.addEventListener('mouseup', () => {zoom(-0.1)})
savebtn.addEventListener('mouseup', () => {
    if (typeof saveState === 'function') saveState(true)
})
centerbtn.addEventListener('mouseup', () => {
    if (typeof centerCanvas === 'function') centerCanvas();
})
focusbtn.addEventListener('mouseup', () => {
    if (typeof toggleFocusMode === 'function') toggleFocusMode();
})
layoutbtn.addEventListener('mouseup', (e) => {
    e.preventDefault()
    if (typeof autoLayout === 'function') {
        if (e.ctrlKey || e.metaKey) {
            autoLayout(false);
        } else {
            autoLayout(true);
        }
    }
})
wipebtn.addEventListener('mouseup', () => {
    if (typeof wipeState === 'function') wipeState();
})