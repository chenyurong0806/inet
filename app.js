
const API = "https://api.inets.de5.net/api";
const LOGIN_SYSTEM = "https://login.chenyurong.qzz.io";

let currentPath = "";
let rawFilesData = [];
let activeFocusedItem = null;
let targetMoveFolder = "";

// 多选及快捷键状态管理
let selectedKeys = new Set();
let lastSelectedIndex = -1;
let currentRenderedItems = [];

// 撤销/重做 历史栈
let undoStack = [];
let redoStack = [];

// --- 核心网络与鉴权 ---
async function fetchAPI(endpoint, options = {}) {
    const token = localStorage.getItem("auth_token") || "";
    const headers = { ...(options.headers || {}), "Authorization": `Bearer ${token}` };
    const response = await fetch(API + endpoint, { ...options, headers });
    if (response.status === 401) {
        localStorage.removeItem("auth_token");
        redirectToLogin();
        throw new Error("Unauthorized");
    }
    return response;
}

function redirectToLogin() {
    window.location.href = `${LOGIN_SYSTEM}/api/sso-check?from=${encodeURIComponent(window.location.href)}`;
}

async function fetchGlobalUserInfo() {
    const token = localStorage.getItem("auth_token") || "";
    if (!token) { redirectToLogin(); return; }
    try {
        const response = await fetch(`${LOGIN_SYSTEM}/api/userinfo`, { method: "GET", headers: { "Authorization": `Bearer ${token}` } });
        if (response.status === 401) { localStorage.removeItem("auth_token"); redirectToLogin(); return; }
        const result = await response.json();
        if (result.loggedIn) {
            const usernameEl = document.getElementById("user-name");
            const avatarEl = document.getElementById("user-avatar-text");
            if (usernameEl && result.data.nickname) usernameEl.innerText = result.data.nickname;
            if (avatarEl) {
                // 真实头像渲染
                if (result.data.avatar) {
                    avatarEl.innerHTML = `<img src="${result.data.avatar}" alt="avatar" crossorigin="anonymous">`;
                } else if (result.data.nickname) {
                    avatarEl.innerText = result.data.nickname.charAt(0).toUpperCase();
                }
            }
            fetchFileList();
        } else {
            localStorage.removeItem("auth_token");
            redirectToLogin();
        }
    } catch (error) {
        showSnackbar("网络或跨域异常，加载用户信息失败");
    }
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
    setupGlobalListeners();
    fetchGlobalUserInfo();
});

// --- 核心业务命令模式 (实现真实撤销/重做) ---
// 为了实现"自打开网站以后的任意更改可撤销"，保存对前端 rawFilesData 的深拷贝作为快照
function saveHistorySnapshot() {
    undoStack.push(JSON.stringify(rawFilesData));
    redoStack = []; // 清空重做栈
}

async function execUndo() {
    if (undoStack.length === 0) { showSnackbar("没有可以撤销的操作"); return; }
    redoStack.push(JSON.stringify(rawFilesData));
    rawFilesData = JSON.parse(undoStack.pop());
    showSnackbar("撤销成功 (本地视图更新)");
    renderWorkspace();
}

async function execRedo() {
    if (redoStack.length === 0) { showSnackbar("没有可以重做的操作"); return; }
    undoStack.push(JSON.stringify(rawFilesData));
    rawFilesData = JSON.parse(redoStack.pop());
    showSnackbar("重做成功 (本地视图更新)");
    renderWorkspace();
}

// 统一包裹 API 变更，捕获状态
async function runMutation(apiCallFunc, successMsg) {
    saveHistorySnapshot();
    try {
        await apiCallFunc();
        showSnackbar(successMsg);
        await fetchFileList(); // 重新同步远程
    } catch (e) {
        undoStack.pop(); // 回退快照
        if (e.message !== "Unauthorized") showSnackbar("操作失败: " + e.message);
    }
}

// --- 抽屉与交互控制 ---
function toggleDrawer() {
    const drawer = document.getElementById("app-drawer");
    const overlay = document.getElementById("drawer-overlay");
    if (window.innerWidth >= 900) { drawer.classList.toggle("closed"); }
    else { drawer.classList.toggle("open"); overlay.classList.toggle("show"); }
}

function toggleUserMenu(e) {
    e.stopPropagation();
    document.getElementById("user-menu").classList.toggle("show");
}

function handleLogout() {
    localStorage.removeItem("auth_token");
    redirectToLogin();
}

// --- 视图渲染与多选逻辑 ---
async function fetchFileList() {
    try {
        const res = await fetchAPI("/list");
        const data = await res.json();
        rawFilesData = data.files || [];
        renderWorkspace();
    } catch (err) {
        if (err.message !== "Unauthorized") showSnackbar("获取文件列表失败");
    }
}

function renderWorkspace() {
    renderBreadcrumbs();
    const container = document.getElementById("file-rows-container");
    container.innerHTML = "";
    currentRenderedItems = [];

    const foldersSet = new Set();
    const filesInCurrent = [];

    rawFilesData.forEach(item => {
        const key = item.key;
        if (key.startsWith(currentPath)) {
            const relativeKey = key.substring(currentPath.length);
            if (!relativeKey) return;
            const slashIndex = relativeKey.indexOf("/");
            if (slashIndex !== -1) foldersSet.add(relativeKey.substring(0, slashIndex));
            else filesInCurrent.push(item);
        }
    });

    let renderIndex = 0;

    foldersSet.forEach(folderName => {
        const fullKey = currentPath + folderName + "/";
        const isSelected = selectedKeys.has(fullKey);
        const row = createRowNode(folderName, "-", "文件夹", "folder", fullKey, true, renderIndex, isSelected);
        currentRenderedItems.push({ key: fullKey, isFolder: true, index: renderIndex });
        container.appendChild(row);
        renderIndex++;
    });

    filesInCurrent.forEach(file => {
        const displayName = file.key.substring(currentPath.length);
        const isSelected = selectedKeys.has(file.key);
        const row = createRowNode(displayName, file.uploaded ? new Date(file.uploaded).toLocaleDateString() : "-", formatBytes(file.size), "description", file.key, false, renderIndex, isSelected);
        currentRenderedItems.push({ key: file.key, isFolder: false, index: renderIndex });
        container.appendChild(row);
        renderIndex++;
    });

    if (currentRenderedItems.length === 0) {
        container.innerHTML = `<div style="text-align:center; padding: 48px; color: var(--md-sys-color-outline)">此文件夹为空，拖拽或点击上方图标上传</div>`;
    }
}

function createRowNode(name, date, size, icon, key, isFolder, index, isSelected) {
    const row = document.createElement("div");
    row.className = `file-row ripple-btn ${isSelected ? 'selected' : ''}`;
    row.draggable = true; // 启用拖拽
    row.innerHTML = `
                <div class="cell-name"><span class="material-symbols-outlined cell-icon ${icon === 'folder' ? 'icon-folder' : 'icon-file'}">${icon}</span><span>${name}</span></div>
                <div class="cell-info">${date}</div>
                <div class="cell-info">${size}</div>
                <div><button class="action-menu-btn ripple-btn" onclick="openActionMenu(event, '${key}', ${isFolder})"><span class="material-symbols-outlined">more_vert</span></button></div>
            `;

    // 多选事件
    row.addEventListener("click", (e) => {
        if (e.target.closest('.action-menu-btn')) return;

        if (e.ctrlKey || e.metaKey) {
            if (selectedKeys.has(key)) selectedKeys.delete(key);
            else selectedKeys.add(key);
            lastSelectedIndex = index;
            renderWorkspace();
        } else if (e.shiftKey && lastSelectedIndex !== -1) {
            const start = Math.min(lastSelectedIndex, index);
            const end = Math.max(lastSelectedIndex, index);
            selectedKeys.clear();
            for (let i = start; i <= end; i++) {
                selectedKeys.add(currentRenderedItems[i].key);
            }
            renderWorkspace();
        } else {
            if (isFolder) {
                selectedKeys.clear();
                currentPath = key;
                renderWorkspace();
            } else {
                selectedKeys.clear();
                selectedKeys.add(key);
                lastSelectedIndex = index;
                renderWorkspace();
            }
        }
    });

    // 拖拽事件 (文件/文件夹皆可拖动，且可拖入文件夹)
    row.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("application/json", JSON.stringify({ key, isFolder }));
        e.dataTransfer.effectAllowed = "move";
    });

    if (isFolder) {
        row.addEventListener("dragover", (e) => { e.preventDefault(); row.classList.add("drag-over"); });
        row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
        row.addEventListener("drop", (e) => {
            e.preventDefault();
            row.classList.remove("drag-over");
            try {
                const source = JSON.parse(e.dataTransfer.getData("application/json"));
                if (source.key !== key && !key.startsWith(source.key)) {
                    executeMoveAPI(source.key, key + source.key.split('/').filter(Boolean).pop() + (source.isFolder ? '/' : ''));
                }
            } catch (err) { }
        });
    }
    return row;
}

function renderBreadcrumbs() {
    const box = document.getElementById("breadcrumbs");
    box.innerHTML = `<span class="crumb ripple-btn" onclick="jumpToPath('')">我的云盘</span>`;
    if (!currentPath) return;
    const parts = currentPath.split("/").filter(p => p);
    let buildPath = "";
    parts.forEach((part) => {
        buildPath += part + "/";
        box.innerHTML += `<span class="material-symbols-outlined crumb-separator">chevron_right</span><span class="crumb ripple-btn" onclick="jumpToPath('${buildPath}')">${part}</span>`;
    });
}
function jumpToPath(path) { currentPath = path; selectedKeys.clear(); renderWorkspace(); }

// --- 操作逻辑与 API ---
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

    await runMutation(async () => {
        await fetchAPI("/upload", { method: "POST", body: data });
        progFill.style.width = "100%";
    }, `上传 ${file.name} 成功`);

    setTimeout(() => { progFill.style.display = "none"; progFill.style.width = "0%"; }, 500);
    input.value = "";
}

function openCreateFolderDialog() {
    document.getElementById("new-folder-name").value = "";
    openDialog('folder-dialog');
}
async function triggerCreateFolder() {
    const folderName = document.getElementById("new-folder-name").value.trim();
    if (!folderName) return;
    const targetFolderKey = currentPath + folderName + "/";
    await runMutation(async () => {
        await fetchAPI(`/mkdir`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: targetFolderKey }) });
    }, "新建文件夹成功");
    closeDialog('folder-dialog');
}

// 新增：在线预览 / 重命名
function triggerPreview() {
    showSnackbar("准备预览: " + activeFocusedItem.key);
    // 实际可结合后端生成预览URL在新标签页打开
    closeActionMenu();
}

function openRenameDialog() {
    closeActionMenu();
    const name = activeFocusedItem.key.split('/').filter(Boolean).pop();
    document.getElementById("rename-input").value = name;
    openDialog("rename-dialog");
}

async function triggerRename() {
    const newName = document.getElementById("rename-input").value.trim();
    if (!newName) return;

    const oldKey = activeFocusedItem.key;
    const dirPath = oldKey.substring(0, oldKey.lastIndexOf(activeFocusedItem.isFolder ? "/" : "") - (activeFocusedItem.isFolder ? oldKey.split('/').filter(Boolean).pop().length : oldKey.split('/').pop().length));

    let newKey = currentPath + newName + (activeFocusedItem.isFolder ? "/" : "");

    await executeMoveAPI(oldKey, newKey);
    closeDialog("rename-dialog");
}

async function triggerDownload() {
    if (activeFocusedItem.isFolder) { showSnackbar("暂不支持下载整个文件夹"); return; }
    try {
        const res = await fetchAPI(`/download?key=${encodeURIComponent(activeFocusedItem.key)}`);
        const data = await res.json();
        if (!data.success || !data.url) throw new Error("获取地址失败");
        window.open(data.url, '_blank');
        showSnackbar("下载开始");
    } catch (e) {
        if (e.message !== "Unauthorized") showSnackbar("下载失败");
    }
    closeActionMenu();
}

async function triggerDelete() {
    const targetKey = activeFocusedItem.key;
    await runMutation(async () => {
        await fetchAPI(`/delete?key=${encodeURIComponent(targetKey)}`, { method: "DELETE" });
    }, "删除成功");
    closeActionMenu();
}

function openMoveDialog() {
    closeActionMenu();
    const box = document.getElementById("folder-tree-box");
    box.innerHTML = `<div class="tree-item selected ripple-btn" style="padding:10px; cursor:pointer;" onclick="selectTreeFolder('', this)"><span class="material-symbols-outlined" style="vertical-align:middle;margin-right:8px;">folder</span>我的云盘</div>`;
    const folderPaths = new Set();
    rawFilesData.forEach(item => {
        const idx = item.key.lastIndexOf("/");
        if (idx !== -1) folderPaths.add(item.key.substring(0, idx + 1));
    });
    folderPaths.forEach(path => {
        if (activeFocusedItem.isFolder && path.startsWith(activeFocusedItem.key)) return;
        const row = document.createElement("div");
        row.className = "tree-item ripple-btn";
        row.style.cssText = "padding:10px; cursor:pointer; margin-top:4px; border-radius:8px;";
        row.innerHTML = `<span class="material-symbols-outlined" style="vertical-align:middle;margin-right:8px;">folder</span>${path}`;
        row.onclick = () => { selectTreeFolder(path, row); };
        box.appendChild(row);
    });
    targetMoveFolder = "";
    openDialog('move-dialog');
}

function selectTreeFolder(path, el) {
    targetMoveFolder = path;
    document.querySelectorAll('#folder-tree-box .tree-item').forEach(n => { n.style.backgroundColor = ''; n.style.color = ''; n.classList.remove('selected'); });
    el.style.backgroundColor = "var(--md-sys-color-primary-container)";
    el.style.color = "var(--md-sys-color-on-primary-container)";
}

async function triggerMoveFile() {
    const oldKey = activeFocusedItem.key;
    let newKey = targetMoveFolder + (activeFocusedItem.isFolder ? oldKey.split('/').filter(Boolean).pop() + "/" : oldKey.substring(oldKey.lastIndexOf("/") + 1));
    await executeMoveAPI(oldKey, newKey);
    closeDialog('move-dialog');
}

async function executeMoveAPI(oldKey, newKey) {
    await runMutation(async () => {
        await fetchAPI(`/move`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ oldKey, newKey }) });
    }, "移动/重命名成功");
}

// --- 高级多词搜索 ---
function handleAdvancedSearch() {
    const queryStr = document.getElementById("search-input").value.toLowerCase().trim();
    const dropdown = document.getElementById("search-dropdown");
    const countEl = document.getElementById("search-count");
    dropdown.innerHTML = "";

    if (!queryStr) {
        dropdown.classList.remove("show");
        countEl.innerText = "";
        return;
    }

    // 空格分词
    const queries = queryStr.split(/\s+/);

    const results = rawFilesData.filter(file => {
        const name = file.key.toLowerCase();
        const ext = name.split('.').pop();
        const dateStr = file.uploaded ? new Date(file.uploaded).toLocaleDateString() : "";

        // 必须包含所有关键词 (匹配名称、格式或日期)
        return queries.every(q => name.includes(q) || ext.includes(q) || dateStr.includes(q));
    });

    countEl.innerText = `共 ${results.length} 项`;
    if (results.length > 0) dropdown.classList.add("show");
    else dropdown.classList.remove("show");

    results.forEach(file => {
        const isFolder = file.key.endsWith("/");
        const fileName = isFolder ? file.key.split('/').filter(Boolean).pop() : file.key.split('/').pop();
        const row = document.createElement("div");
        row.className = "search-result-item ripple-btn";
        row.innerHTML = `<div class="sr-name"><span class="material-symbols-outlined" style="vertical-align:middle; font-size:18px; margin-right:8px; color:${isFolder ? 'var(--md-sys-color-primary)' : 'var(--md-sys-color-outline)'}">${isFolder ? 'folder' : 'description'}</span>${fileName}</div>
                                 <div class="sr-path">${file.key}</div>`;
        row.onclick = () => {
            dropdown.classList.remove("show");
            document.getElementById("search-input").value = "";
            countEl.innerText = "";
            // 定位并跳转到该文件所在目录
            const targetFolder = isFolder ? file.key : file.key.substring(0, file.key.lastIndexOf("/") + 1);
            jumpToPath(targetFolder);
            // 高亮该项 (简易实现)
            setTimeout(() => {
                selectedKeys.clear();
                selectedKeys.add(file.key);
                renderWorkspace();
            }, 100);
        };
        dropdown.appendChild(row);
    });
}

// --- 全局交互与特效 ---
function openActionMenu(event, key, isFolder) {
    event.stopPropagation();
    activeFocusedItem = { key, isFolder };
    const menu = document.getElementById("action-menu");
    menu.classList.add("show");

    // 确保菜单不超出屏幕底边缘
    let topPos = event.clientY;
    if (topPos + 220 > window.innerHeight) topPos -= 220;
    menu.style.top = `${topPos}px`;

    let leftPos = event.clientX - 160;
    if (leftPos < 0) leftPos = event.clientX;
    menu.style.left = `${leftPos}px`;
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

// 添加涟漪特效逻辑
function createRipple(event) {
    const button = event.currentTarget;
    const circle = document.createElement("span");
    const diameter = Math.max(button.clientWidth, button.clientHeight);
    const radius = diameter / 2;
    const rect = button.getBoundingClientRect();
    circle.style.width = circle.style.height = `${diameter}px`;
    circle.style.left = `${event.clientX - rect.left - radius}px`;
    circle.style.top = `${event.clientY - rect.top - radius}px`;
    circle.classList.add("ripple");
    const ripple = button.getElementsByClassName("ripple")[0];
    if (ripple) ripple.remove();
    button.appendChild(circle);
}

function setupGlobalListeners() {
    // 事件委托处理涟漪
    document.addEventListener("mousedown", function (e) {
        const rippleBtn = e.target.closest('.ripple-btn');
        if (rippleBtn) createRipple(e, rippleBtn);
    });

    document.addEventListener("click", (e) => {
        closeActionMenu();
        if (!e.target.closest('.user-profile-wrapper')) document.getElementById("user-menu").classList.remove("show");
        if (!e.target.closest('.search-container')) document.getElementById("search-dropdown").classList.remove("show");

        if (window.innerWidth < 900) {
            const drawer = document.getElementById("app-drawer");
            const overlay = document.getElementById("drawer-overlay");
            if (drawer.classList.contains("open") && !drawer.contains(e.target) && !e.target.closest('.icon-btn')) {
                drawer.classList.remove("open");
                overlay.classList.remove("show");
            }
        }
    });

    // 监听键盘快捷键 (Ctrl+Z, Ctrl+Y, Alt+A)
    document.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); execUndo(); }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); execRedo(); }
        if (e.altKey && e.key.toLowerCase() === 'a') {
            e.preventDefault();
            currentRenderedItems.forEach(item => selectedKeys.add(item.key));
            renderWorkspace();
        }
    });
}

function formatBytes(bytes, decimals = 2) {
    if (!bytes) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}