const API = "https://api.inets.de5.net/api";
const LOGIN_SYSTEM = "https://login.chenyurong.qzz.io";

let currentPath = "";
let rawFilesData = [];
let activeFocusedItem = null;
let targetMoveFolder = "";

async function fetchAPI(endpoint, options = {}) {
    const token = localStorage.getItem("auth_token") || "";

    const headers = {
        ...(options.headers || {}),
        "Authorization": `Bearer ${token}`
    };

    const response = await fetch(API + endpoint, {
        ...options,
        headers
    });

    if (response.status === 401) {
        window.location.href = `${LOGIN_SYSTEM}/api/sso-check?from=${encodeURIComponent(window.location.href)}`;
        throw new Error("Unauthorized");
    }

    return response;
}

window.addEventListener("DOMContentLoaded", () => {
    const urlParams = new URLSearchParams(window.location.search);
    const ssoToken = urlParams.get("sso_token");
    if (ssoToken) {
        localStorage.setItem("auth_token", ssoToken);
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete("sso_token");
        window.history.replaceState({}, document.title, cleanUrl.toString());
    }

    setupOutsideClicks();
    fetchFileList();
});

async function fetchFileList() {
    try {
        const res = await fetchAPI("/list");
        const data = await res.json();
        rawFilesData = data.files || [];
        renderWorkspace();
    } catch (err) {
        if (err.message !== "Unauthorized") {
            showSnackbar("获取文件列表失败");
        }
    }
}

function renderWorkspace() {
    renderBreadcrumbs();
    const container = document.getElementById("file-rows-container");
    container.innerHTML = "";

    const foldersSet = new Set();
    const filesInCurrent = [];

    rawFilesData.forEach(item => {
        const key = item.key;
        if (key.startsWith(currentPath)) {
            const relativeKey = key.substring(currentPath.length);
            if (!relativeKey) return;

            const slashIndex = relativeKey.indexOf("/");
            if (slashIndex !== -1) {
                foldersSet.add(relativeKey.substring(0, slashIndex));
            } else {
                filesInCurrent.push(item);
            }
        }
    });

    // 渲染文件夹 (匹配 4 列网格)
    foldersSet.forEach(folderName => {
        const row = document.createElement("div");
        row.className = "file-row";
        row.innerHTML = `
            <div class="cell-name">
                <span class="material-symbols-outlined cell-icon icon-folder">folder</span>
                <span>${folderName}</span>
            </div>
            <div class="cell-info">文件夹</div>
            <div class="cell-info">--</div>
            <div class="cell-info">--</div>
            <div>
                <button class="action-menu-btn" onclick="openActionMenu(event, '${currentPath}${folderName}/', true)">
                    <span class="material-symbols-outlined">more_vert</span>
                </button>
            </div>
        `;
        row.addEventListener("click", (e) => {
            if (e.target.closest('.action-menu-btn')) return;
            currentPath += folderName + "/";
            renderWorkspace();
        });
        container.appendChild(row);
    });

    // 渲染文件 (匹配 4 列网格)
    filesInCurrent.forEach(file => {
        const displayName = file.key.substring(currentPath.length);
        const fileExt = displayName.split('.').pop().toUpperCase(); // 简单提取扩展名作为类型
        
        const row = document.createElement("div");
        row.className = "file-row";
        row.innerHTML = `
            <div class="cell-name">
                <span class="material-symbols-outlined cell-icon icon-file">description</span>
                <span>${displayName}</span>
            </div>
            <div class="cell-info">${fileExt} 文件</div>
            <div class="cell-info">${formatBytes(file.size)}</div>
            <div class="cell-info">${file.uploaded ? new Date(file.uploaded).toLocaleDateString() : "-"}</div>
            <div>
                <button class="action-menu-btn" onclick="openActionMenu(event, '${file.key}', false)">
                    <span class="material-symbols-outlined">more_vert</span>
                </button>
            </div>
        `;
        container.appendChild(row);
    });

    if (foldersSet.size === 0 && filesInCurrent.length === 0) {
        container.innerHTML = `<div style="text-align:center; padding: 48px; color: var(--md-sys-color-outline); grid-column: span 5;">此文件夹为空，拖拽或点击新建上传文件</div>`;
    }
}

function renderBreadcrumbs() {
    const box = document.getElementById("breadcrumbs");
    box.innerHTML = `<span class="crumb" onclick="jumpToPath('')">我的云盘</span>`;
    if (!currentPath) return;

    const parts = currentPath.split("/").filter(p => p);
    let buildPath = "";
    parts.forEach((part) => {
        buildPath += part + "/";
        box.innerHTML += `
            <span class="material-symbols-outlined crumb-separator">chevron_right</span>
            <span class="crumb" onclick="jumpToPath('${buildPath}')">${part}</span>
        `;
    });
}

function jumpToPath(path) { currentPath = path; renderWorkspace(); }

function openUploadSelect() { document.getElementById("file-input").click(); }

async function handleFileSelect(input) {
    let file = input.files[0];
    if (!file) return;

    let targetKey = currentPath + file.name;
    let data = new FormData();
    data.append("file", file);
    data.append("key", targetKey);

    const progFill = document.getElementById("upload-progress-fill");
    progFill.style.display = "block";
    setTimeout(() => { progFill.style.width = "40%"; }, 100);

    try {
        await fetchAPI("/upload", { method: "POST", body: data });
        progFill.style.width = "100%";
        showSnackbar(`上传成功`);
        await fetchFileList(); 
    } catch (err) {
        showSnackbar("上传失败");
    } finally {
        setTimeout(() => { progFill.style.display = "none"; progFill.style.width = "0%"; }, 500);
        input.value = "";
    }
}

function openCreateFolderDialog() {
    document.getElementById("new-folder-name").value = "";
    openDialog('folder-dialog');
}

async function triggerCreateFolder() {
    const folderName = document.getElementById("new-folder-name").value.trim();
    if (!folderName) return;

    const targetFolderKey = currentPath + folderName + "/";

    try {
        await fetchAPI(`/mkdir`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key: targetFolderKey })
        });
        showSnackbar("新建文件夹成功");
        await fetchFileList();
    } catch (e) {
        showSnackbar("创建失败");
    }
    closeDialog('folder-dialog');
}

// 在线预览功能 (通过新标签页打开URL实现预览效果)
async function triggerPreview() {
    // 如果是文件夹，则直接打开文件夹
    if (activeFocusedItem.isFolder) {
        const folderName = activeFocusedItem.key.split('/').filter(Boolean).pop();
        currentPath += folderName + "/";
        renderWorkspace();
        closeActionMenu();
        return;
    }

    try {
        const res = await fetchAPI(`/download?key=${encodeURIComponent(activeFocusedItem.key)}`);
        const data = await res.json();

        if (!data.success || !data.url) {
            throw new Error(data.message || "获取预览地址失败");
        }
        
        // 使用新标签页打开实现预览
        window.open(data.url, '_blank');
        showSnackbar("正在打开在线预览...");
    } catch (e) {
        console.error(e);
        showSnackbar("预览失败");
    }
    closeActionMenu();
}

// 直接下载文件
async function triggerDownload() {
    if (activeFocusedItem.isFolder) {
        showSnackbar("暂不支持下载整个文件夹");
        return;
    }
    try {
        const res = await fetchAPI(`/download?key=${encodeURIComponent(activeFocusedItem.key)}`);
        const data = await res.json();

        if (!data.success || !data.url) {
            throw new Error(data.message || "获取下载地址失败");
        }

        const a = document.createElement("a");
        a.href = data.url;
        // 尝试附加 download 属性触发浏览器强制下载行为
        const fileName = activeFocusedItem.key.substring(activeFocusedItem.key.lastIndexOf("/") + 1);
        a.download = fileName; 
        a.target = "_blank";
        
        document.body.appendChild(a);
        a.click();
        a.remove();
        showSnackbar("下载开始");
    } catch (e) {
        console.error(e);
        showSnackbar("下载失败");
    }
    closeActionMenu();
}

// 删除文件
async function triggerDelete() {
    const targetKey = activeFocusedItem.key;
    try {
        await fetchAPI(`/delete?key=${encodeURIComponent(targetKey)}`, { method: "DELETE" });
        showSnackbar("删除成功");
        await fetchFileList();
    } catch (e) {
        showSnackbar("删除失败");
    }
    closeActionMenu();
}

function openMoveDialog() {
    closeActionMenu();
    const box = document.getElementById("folder-tree-box");
    box.innerHTML = `<div class="tree-item selected" onclick="selectTreeFolder('')"><span class="material-symbols-outlined">folder</span>我的云盘</div>`;

    const folderPaths = new Set();
    rawFilesData.forEach(item => {
        const idx = item.key.lastIndexOf("/");
        if (idx !== -1) folderPaths.add(item.key.substring(0, idx + 1));
    });

    folderPaths.forEach(path => {
        if (activeFocusedItem.isFolder && path.startsWith(activeFocusedItem.key)) return;
        const row = document.createElement("div");
        row.className = "tree-item";
        row.innerHTML = `<span class="material-symbols-outlined">folder</span>${path}`;
        row.onclick = () => {
            document.querySelectorAll('.tree-item').forEach(el => el.classList.remove('selected'));
            row.classList.add('selected');
            selectTreeFolder(path);
        };
        box.appendChild(row);
    });

    targetMoveFolder = "";
    openDialog('move-dialog');
}

function selectTreeFolder(path) { targetMoveFolder = path; }

async function triggerMoveFile() {
    const oldKey = activeFocusedItem.key;
    let newKey = "";

    if (activeFocusedItem.isFolder) {
        const folderName = oldKey.split('/').filter(Boolean).pop();
        newKey = targetMoveFolder + folderName + "/";
    } else {
        const fileName = oldKey.substring(oldKey.lastIndexOf("/") + 1);
        newKey = targetMoveFolder + fileName;
    }

    try {
        await fetchAPI(`/move`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ oldKey, newKey })
        });
        showSnackbar("移动成功");
        await fetchFileList();
    } catch (e) {
        showSnackbar("移动失败");
    }
    closeDialog('move-dialog');
}

function handleSearch() {
    const query = document.getElementById("search-input").value.toLowerCase().trim();
    if (!query) { renderWorkspace(); return; }

    const container = document.getElementById("file-rows-container");
    container.innerHTML = "";

    rawFilesData.forEach(file => {
        if (file.key.toLowerCase().includes(query) && !file.key.endsWith("/")) {
            const row = document.createElement("div");
            row.className = "file-row";
            row.innerHTML = `
                <div class="cell-name">
                    <span class="material-symbols-outlined cell-icon icon-file">description</span>
                    <span>${file.key}</span>
                </div>
                <div class="cell-info">全局搜索</div>
                <div class="cell-info">${formatBytes(file.size)}</div>
                <div class="cell-info">--</div>
                <div>
                    <button class="action-menu-btn" onclick="openActionMenu(event, '${file.key}', false)">
                        <span class="material-symbols-outlined">more_vert</span>
                    </button>
                </div>
            `;
            container.appendChild(row);
        }
    });
}

// 占位功能提示
function triggerPlaceholder(actionName) {
    showSnackbar(`"${actionName}" 功能正在开发中...`);
    closeActionMenu();
}

// 交互组件函数
function openActionMenu(event, key, isFolder) {
    event.stopPropagation();
    activeFocusedItem = { key, isFolder };
    const menu = document.getElementById("action-menu");

    // 根据目标类型(文件/文件夹)动态调整菜单展示
    const previewText = document.getElementById("text-preview");
    const previewIcon = document.getElementById("icon-preview");
    const downloadItem = document.getElementById("menu-item-download");

    if (isFolder) {
        previewText.innerText = "打开";
        previewIcon.innerText = "folder_open";
        downloadItem.style.display = "none"; // 文件夹隐藏下载
    } else {
        previewText.innerText = "在线预览";
        previewIcon.innerText = "visibility";
        downloadItem.style.display = "flex"; // 文件展示下载
    }

    menu.classList.add("show");
    
    // 防止菜单溢出屏幕底部
    let top = event.clientY;
    let left = event.clientX - 200;
    
    // 简单边界处理
    if(top + menu.offsetHeight > window.innerHeight) {
        top = window.innerHeight - menu.offsetHeight - 16; 
    }

    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
}

function closeActionMenu() { document.getElementById("action-menu").classList.remove("show"); }
function openDialog(id) { document.getElementById(id).classList.add("show"); }
function closeDialog(id) { document.getElementById(id).classList.remove("show"); }

function showSnackbar(msg) {
    const bar = document.getElementById("global-snackbar");
    bar.innerText = msg;
    bar.classList.add("show");
    setTimeout(() => { bar.classList.remove("show"); }, 3000);
}

function setupOutsideClicks() {
    document.addEventListener("click", () => { closeActionMenu(); });
}

function formatBytes(bytes, decimals = 2) {
    if (!bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}