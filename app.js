const API = "https://api.inets.de5.net/api"; 
const LOGIN_SYSTEM = "https://login.chenyurong.qzz.io";

let currentPath = "";
let rawFilesData = [];
let activeFocusedItem = null;
let targetMoveFolder = "";

// 基础跨域 Fetch 包装器 (携带前端 Token 并做 401 统一拦截)
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
        // 本地 Token 已过期，清除并引导去中央登录系统
        localStorage.removeItem("auth_token");
        redirectToLogin();
        throw new Error("Unauthorized");
    }

    return response;
}

// === 核心登录状态管理与重定向 ===

// 引导去登录
function redirectToLogin() {
    // 强制携带 from 参数作为回跳地址
    window.location.href = `${LOGIN_SYSTEM}/api/sso-check?from=${encodeURIComponent(window.location.href)}`;
}

// 跨域读取用户信息及登录校验初始化函数
async function fetchGlobalUserInfo() {
    const token = localStorage.getItem("auth_token") || "";
    
    if (!token) {
        console.log("本地没有凭证，直接重定向到登录页...");
        redirectToLogin();
        return;
    }

    try {
        const response = await fetch(`${LOGIN_SYSTEM}/api/userinfo`, {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${token}`
            }
        });

        if (response.status === 401) {
            console.log("凭证失效 (401)，准备重定向...");
            localStorage.removeItem("auth_token");
            redirectToLogin();
            return;
        }

        const result = await response.json();

        if (result.loggedIn) {
            console.log("成功跨域读取到用户信息：", result.data);
            
            // 渲染用户信息到网盘 UI
            const usernameEl = document.getElementById("user-name");
            const avatarEl = document.getElementById("user-avatar-text");
            if (usernameEl && result.data.nickname) {
                usernameEl.innerText = result.data.nickname;
            }
            if (avatarEl && result.data.nickname) {
                avatarEl.innerText = result.data.nickname.charAt(0).toUpperCase();
            }

            // 只有当登录状态校验通过后，才允许获取网盘资源列表 (解决循环渲染及安全问题)
            fetchFileList();
        } else {
            console.log("当前未登录 (loggedIn 为 false)，准备重定向...");
            localStorage.removeItem("auth_token");
            redirectToLogin();
        }
    } catch (error) {
        console.error("跨域请求用户信息网络失败", error);
        // 重要网络错误防死循环防护：若为断网/CORS跨域故障，提示用户，不直接无脑redirectToLogin，防止引起无网下的白屏重定向死循环
        showSnackbar("无法建立安全鉴权，请检查网络或跨域配置");
    }
}

// 新前端本地表单登录成功后的通用令牌存储处理方法 (如需在本地自主渲染登录页)
async function handleLocalLoginSuccess(token) {
    localStorage.setItem('auth_token', token);
    window.location.reload();
}

// 页面加载时的统一拦截及解析
window.addEventListener("DOMContentLoaded", () => {
    const urlParams = new URLSearchParams(window.location.search);
    const ssoToken = urlParams.get("sso_token");
    
    if (ssoToken) {
        // 如果网址里带了 token，说明是刚从登录页登录成功跳回来的，存好并安全抹去 URL 痕迹
        localStorage.setItem("auth_token", ssoToken);
        
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete("sso_token");
        window.history.replaceState({}, document.title, cleanUrl.toString());
    }

    setupOutsideClicks();
    
    // 执行获取用户信息与页面状态初始化
    fetchGlobalUserInfo();
});

// === 抽屉控制及云盘文件管理业务逻辑 ===

function toggleDrawer() {
    const drawer = document.getElementById("app-drawer");
    const overlay = document.getElementById("drawer-overlay");
    if (window.innerWidth >= 900) {
        drawer.classList.toggle("closed");
    } else {
        drawer.classList.toggle("open");
        overlay.classList.toggle("show");
    }
}

// 1. 获取文件列表
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
        container.innerHTML = `<div style="text-align:center; padding: 48px; color: var(--md-sys-color-outline)">此文件夹为空，点击上方图标上传文件</div>`;
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
        await fetchFileList(); 
    } catch (err) {
        if (err.message !== "Unauthorized") {
            showSnackbar("上传失败");
        }
    } finally {
        setTimeout(() => { progFill.style.display = "none"; progFill.style.width = "0%"; }, 500);
        input.value = "";
    }
}

// 4. 新建文件夹
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
        if (e.message !== "Unauthorized") showSnackbar("创建失败");
    }
    closeDialog('folder-dialog');
}

// 5. 下载文件
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
        a.target = "_blank";
        document.body.appendChild(a);
        a.click();
        a.remove();

        showSnackbar("下载开始");
    } catch (e) {
        if (e.message !== "Unauthorized") {
            console.error(e);
            showSnackbar("下载失败");
        }
    }
    closeActionMenu();
}

// 6. 删除文件
async function triggerDelete() {
    const targetKey = activeFocusedItem.key;
    try {
        await fetchAPI(`/delete?key=${encodeURIComponent(targetKey)}`, { method: "DELETE" });
        showSnackbar("删除成功");
        await fetchFileList();
    } catch (e) {
        if (e.message !== "Unauthorized") showSnackbar("删除失败");
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
        if (e.message !== "Unauthorized") showSnackbar("移动失败");
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

// 弹窗与悬浮面板组件
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
    document.addEventListener("click", (e) => { 
        closeActionMenu(); 
        
        // 移动端：当点击侧栏抽屉外面的元素时，自动收起抽屉
        if (window.innerWidth < 900) {
            const drawer = document.getElementById("app-drawer");
            const overlay = document.getElementById("drawer-overlay");
            if (drawer.classList.contains("open") && !drawer.contains(e.target) && !e.target.closest('.icon-btn')) {
                drawer.classList.remove("open");
                overlay.classList.remove("show");
            }
        }
    });
}

function formatBytes(bytes, decimals = 2) {
    if (!bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}