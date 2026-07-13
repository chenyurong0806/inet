const API = "https://api.inets.de5.net/api"; // 注意：此处直接指定到 /api
const LOGIN_SYSTEM = "https://login.chenyurong.qzz.io";

let currentPath = "";   
let rawFilesData = [];  
let activeFocusedItem = null; 
let targetMoveFolder = "";   

// [核心修复]：跨域 Fetch 包装器，自动带上 Token
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
        // 未登录，引导跳转到中央登录系统，并携带回跳地址
        window.location.href = `${LOGIN_SYSTEM}/api/sso-check?from=${encodeURIComponent(window.location.href)}`;
        throw new Error("Unauthorized");
    }
    
    return response;
}

window.addEventListener("DOMContentLoaded", () => {
    // 处理从登录系统跳转回来的 sso_token 
    const urlParams = new URLSearchParams(window.location.search);
    const ssoToken = urlParams.get("sso_token");
    if (ssoToken) {
        localStorage.setItem("auth_token", ssoToken);
        // 清理地址栏
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete("sso_token");
        window.history.replaceState({}, document.title, cleanUrl.toString());
    }

    setupOutsideClicks();
    fetchFileList();
});

// 1. 获取文件列表
async function fetchFileList() {
    try {
        const res = await fetchAPI("/list");
        const data = await res.json();
        rawFilesData = data.files || [];
        renderWorkspace();
    } catch (err) {
        if(err.message !== "Unauthorized") {
            showSnackbar("获取文件列表失败");
        }
    }
}

// 2. 渲染工作区
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

    // 渲染文件夹
    foldersSet.forEach(folderName => {
        const row = document.createElement("div");
        row.className = "file-row";
        row.innerHTML = `
            <div class="cell-name">
                <span class="material-symbols-outlined cell-icon icon-folder">folder</span>
                <span>${folderName}</span>
            </div>
            <div class="cell-info">-</div>
            <div class="cell-info">文件夹</div>
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

    // 渲染文件
    filesInCurrent.forEach(file => {
        const displayName = file.key.substring(currentPath.length);
        const row = document.createElement("div");
        row.className = "file-row";
        row.innerHTML = `
            <div class="cell-name">
                <span class="material-symbols-outlined cell-icon icon-file">description</span>
                <span>${displayName}</span>
            </div>
            <div class="cell-info">${file.uploaded ? new Date(file.uploaded).toLocaleDateString() : "-"}</div>
            <div class="cell-info">${formatBytes(file.size)}</div>
            <div>
                <button class="action-menu-btn" onclick="openActionMenu(event, '${file.key}', false)">
                    <span class="material-symbols-outlined">more_vert</span>
                </button>
            </div>
        `;
        container.appendChild(row);
    });

    if (foldersSet.size === 0 && filesInCurrent.length === 0) {
        container.innerHTML = `<div style="text-align:center; padding: 48px; color: var(--md-sys-color-outline)">此文件夹为空，拖拽或点击新建上传文件</div>`;
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

// 3. 上传文件
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
        await fetchFileList(); // 刷新数据
    } catch (err) {
        showSnackbar("上传失败");
    } finally {
        setTimeout(() => { progFill.style.display = "none"; progFill.style.width = "0%"; }, 500);
        input.value = ""; 
    }
}

// 4. 新建文件夹 [已修复]
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

// 5. 下载文件 [已修复]
async function triggerDownload() {
    if (activeFocusedItem.isFolder) {
        showSnackbar("暂不支持下载整个文件夹");
        return;
    }
    // 跨域带 Auth 头的下载不能直接使用 window.open，需要用 Blob 接收并转换
    try {
        const res = await fetchAPI(`/download?key=${encodeURIComponent(activeFocusedItem.key)}`);
        const blob = await res.blob();
        
        // 解析响应头中的文件名
        const disposition = res.headers.get("Content-Disposition");
        let filename = activeFocusedItem.key.split('/').pop();
        if (disposition && disposition.indexOf('filename=') !== -1) {
            const matches = /filename="([^"]+)"/.exec(disposition);
            if (matches != null && matches[1]) filename = matches[1];
        }

        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = decodeURIComponent(filename);
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();
        showSnackbar("下载开始");
    } catch (e) {
        showSnackbar("下载失败");
    }
    closeActionMenu();
}

// 6. 删除文件 [已修复]
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

// 7. 移动文件
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

// 8. 搜索
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

// 交互组件函数
function openActionMenu(event, key, isFolder) {
    event.stopPropagation();
    activeFocusedItem = { key, isFolder };
    const menu = document.getElementById("action-menu");
    menu.classList.add("show");
    menu.style.top = `${event.clientY}px`;
    menu.style.left = `${event.clientX - 160}px`;
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

