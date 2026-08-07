const DEFAULT_ICON = "icon.png";
let state = { allLinks: [], sessions: [], groups: [] };

let profilesData = {
    activeId: 'prof_1',
    profiles: []
};

function isIgnoredUrl(url) {
    if (!url || typeof url !== 'string') return true;
    const lower = url.toLowerCase();
    return lower.startsWith('chrome://') || 
           lower.startsWith('edge://') || 
           lower.startsWith('about:') || 
           lower.startsWith('chrome-extension://') || 
           lower.startsWith('moz-extension://') || 
           lower.includes('popup.html') ||
           lower.includes('lmnkgnacfjfchnpmbghgjmobignfmcab');
}

document.addEventListener('DOMContentLoaded', () => {
    // Detect if running as full tab (homescreen / new tab page) vs toolbar popup
    const isPopupView = (typeof chrome !== 'undefined' && chrome.extension && chrome.extension.getViews) 
        ? chrome.extension.getViews({ type: 'popup' }).includes(window) 
        : window.innerWidth <= 700;

    if (!isPopupView) {
        document.documentElement.classList.remove('is-popup');
        document.body.classList.remove('is-popup');
    }

    // Nav items
    document.querySelectorAll('.nav-item').forEach((el, index) => {
        el.addEventListener('click', () => {
            const views = ['home', 'sessions', 'groups', 'export'];
            if (index < views.length) switchView(views[index]);
            else if (el.textContent.includes('Cleanup')) removeDuplicates();
            else if (el.textContent.includes('Reset')) resetApp();
            else if (el.id === 'nav-profile' || el.textContent.includes('Profile')) {
                showProfilesModal();
            }
        });
    });

    const navProf = document.getElementById('nav-profile');
    if (navProf) {
        navProf.addEventListener('click', (e) => {
            e.stopPropagation();
            showProfilesModal();
        });
    }

    const sidebarAdd = document.getElementById('btnSidebarAddProfile');
    if (sidebarAdd) sidebarAdd.addEventListener('click', createNewProfile);

    const sidebarManage = document.getElementById('btnSidebarManage');
    if (sidebarManage) sidebarManage.addEventListener('click', showProfilesModal);

    const sidebarMinBtn = document.getElementById('btnToggleSidebarMinimize');
    if (sidebarMinBtn) {
        sidebarMinBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleSidebarMinimize();
        });
    }

    if (localStorage.getItem('sidebarCollapsed_V1') === 'true') {
        setSidebarMinimized(true);
    }

    const overlay = document.getElementById('sidebarOverlay');
    if (overlay) overlay.addEventListener('click', closeSidebarDrawer);

    document.getElementById('btnAddLinks').addEventListener('click', handleHomePaste);
    document.getElementById('sortMode').addEventListener('change', renderHome);
    document.getElementById('btnNewSession').addEventListener('click', createNewSession);
    document.getElementById('btnShuffleGroups').addEventListener('click', generateGroups);
    document.getElementById('btnExportState').addEventListener('click', exportFullState);
    document.getElementById('btnTriggerRestore').addEventListener('click', triggerRestore);
    document.getElementById('restoreInput').addEventListener('change', function() { handleRestoreFile(this); });
    document.getElementById('btnExportMain').addEventListener('click', exportMainLinksTxt);
    document.getElementById('btnExportAllSessions').addEventListener('click', exportAllSessionsTxt);
    
    const navFullscreen = document.getElementById('nav-fullscreen');
    if(navFullscreen) navFullscreen.addEventListener('click', () => {
        chrome.tabs.create({ url: chrome.runtime.getURL("popup.html") });
    });
    
    const btnMerge = document.getElementById('btnMergeSessions');
    if(btnMerge) btnMerge.addEventListener('click', confirmMergeSessions);

    const btnDelDone = document.getElementById('btnDeleteDone');
    if(btnDelDone) btnDelDone.addEventListener('click', deleteDoneLinks);
    const btnDelDoneHome = document.getElementById('btnDeleteDoneHome');
    if(btnDelDoneHome) btnDelDoneHome.addEventListener('click', deleteDoneLinks);

    const btnCancelModal = document.getElementById('modalCancelBtn');
    if(btnCancelModal) btnCancelModal.addEventListener('click', closeModal);

    // Save All Tabs specific
    document.getElementById('btnSaveTabs').addEventListener('click', async () => {
        let tabsList = [];
        if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
            const tabs = await chrome.tabs.query({ currentWindow: true });
            tabsList = tabs.filter(t => t.url && !isIgnoredUrl(t.url));
        }
            
        if (tabsList.length === 0) {
            const dummyUrl = window.location.href;
            if (!isIgnoredUrl(dummyUrl)) {
                tabsList = [{ id: null, url: dummyUrl, title: document.title || 'Current Page', favIconUrl: 'icon.png' }];
            }
        }
        
        showSaveTabsModal(tabsList);
    });

    loadState(); 
    if(state.sessions.length===0) createNewSession(); 
    renderAll();
    switchView('sessions');
});

// Event delegation for dynamic elements
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('session-merge-cb')) {
        e.stopPropagation();
        updateMergeUI();
        return;
    }
    const actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;
    
    const action = actionEl.getAttribute('data-action');
    const id = actionEl.getAttribute('data-id') ? parseFloat(actionEl.getAttribute('data-id')) : null;
    const idsStr = actionEl.getAttribute('data-ids');
    const ids = idsStr ? idsStr.split(',').filter(x=>x).map(Number) : [];
    const url = actionEl.getAttribute('data-url');

    switch (action) {
        case 'toggleWatch': toggleWatch(id); break;
        case 'deleteGlobalLink': deleteGlobalLink(id); break;
        case 'toggleAccordionSession': toggleAccordion('session', id); break;
        case 'toggleAccordionGroup': toggleAccordion('group', id); break;
        case 'exportSessionTxt': e.stopPropagation(); exportSessionTxt(id); break;
        case 'toggleSessionVisibility': e.stopPropagation(); toggleSessionVisibility(id); break;
        case 'closeContainerLinks':
            e.stopPropagation();
            const closeSessIdAttr = actionEl.getAttribute('data-session-id');
            if (closeSessIdAttr) {
                const targetSess = state.sessions.find(x => x.id === parseFloat(closeSessIdAttr));
                if (targetSess) {
                    targetSess.opened = false;
                    // Clear tabOpened on all links since Close is not a manual close
                    targetSess.linkIds.forEach(lid => {
                        const link = state.allLinks.find(l => l.id === lid);
                        if (link) link.tabOpened = false;
                    });
                }
                saveState();
            }
            closeContainerLinks(ids);
            if (closeSessIdAttr) renderSessions();
            break;
        case 'openContainerLinks':
            e.stopPropagation();
            const sessIdAttr = actionEl.getAttribute('data-session-id');
            if (sessIdAttr) {
                const targetSess = state.sessions.find(x => x.id === parseFloat(sessIdAttr));
                if (targetSess) {
                    targetSess.opened = true;
                    // Mark ALL links in this session as opened
                    targetSess.linkIds.forEach(lid => {
                        const link = state.allLinks.find(l => l.id === lid);
                        if (link) link.tabOpened = true;
                    });
                }
                saveState();
            }
            openContainerLinks(ids);
            if (sessIdAttr) renderSessions();
            break;
        case 'matchSessionLinks':
            e.stopPropagation();
            matchSessionLinks(id);
            break;
        case 'renameSession': e.stopPropagation(); editSessionName(id, actionEl.closest('.accordion-header')); break;
        case 'deleteSession': e.stopPropagation(); confirmDeleteSession(id); break;
        case 'deleteGroup': e.stopPropagation(); confirmDeleteGroup(id); break;
        case 'deleteDoneSessionLinks': e.stopPropagation(); deleteDoneSessionLinks(id); break;
        case 'promptAdd': e.stopPropagation(); promptAdd(id); break;
        case 'updateMergeUI': e.stopPropagation(); updateMergeUI(); break;
        case 'deleteSessionLink': e.stopPropagation(); confirmDeleteSessionLink(parseFloat(actionEl.getAttribute('data-session-id')), id); break;
        case 'cardClick': {
            if(e.target.tagName==='BUTTON'||e.target.closest('button'))return;
            e.preventDefault();
            const clickedSessionId = actionEl.getAttribute('data-session-id');
            const clickedLinkId = actionEl.getAttribute('data-link-id');
            if (clickedSessionId) {
                const clickedSess = state.sessions.find(x => x.id === parseFloat(clickedSessionId));
                if (clickedSess) {
                    clickedSess.opened = true;
                    // Mark THIS specific link as opened
                    if (clickedLinkId) {
                        const clickedLink = state.allLinks.find(l => l.id === parseFloat(clickedLinkId));
                        if (clickedLink) clickedLink.tabOpened = true;
                    }
                    saveState();
                    renderSessions();
                }
            }
            chrome.tabs.create({ url: url, active: false });
            break;
        }
    }
});

// Drag and drop logic
let draggedLink = null;
document.addEventListener('dragstart', (e) => {
    const actionEl = e.target.closest('[data-action-dragstart]');
    if(!actionEl) return;
    draggedLink = {
        sessionId: parseFloat(actionEl.getAttribute('data-session-id')),
        linkId: parseFloat(actionEl.getAttribute('data-link-id'))
    };
    e.dataTransfer.effectAllowed = 'move';
});
document.addEventListener('dragover', (e) => {
    if(e.target.closest('[data-drop-zone]')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    }
});
document.addEventListener('drop', (e) => {
    const dropZone = e.target.closest('[data-drop-zone]');
    if(dropZone) {
        e.preventDefault();
        const targetSessionId = parseFloat(dropZone.getAttribute('data-session-id'));
        if (!draggedLink || draggedLink.sessionId === targetSessionId) return;
        const sourceSession = state.sessions.find(s => s.id === draggedLink.sessionId);
        const targetSession = state.sessions.find(s => s.id === targetSessionId);
        if(sourceSession && targetSession) {
            sourceSession.linkIds = sourceSession.linkIds.filter(id => id !== draggedLink.linkId);
            if(!targetSession.linkIds.includes(draggedLink.linkId)) {
                targetSession.linkIds.unshift(draggedLink.linkId);
            }
            saveState(); renderSessions();
        }
    }
    draggedLink = null;
});

function loadState() {
    const rawProfiles = localStorage.getItem('linkMasterProfiles_V1');
    if (rawProfiles) {
        try { profilesData = JSON.parse(rawProfiles); } catch(e) {}
    }

    if (!profilesData || typeof profilesData !== 'object') {
        profilesData = { activeId: 'prof_1', profiles: [] };
    }
    if (!Array.isArray(profilesData.profiles)) {
        profilesData.profiles = [];
    }

    if (profilesData.profiles.length === 0) {
        let legacyState = { allLinks: [], sessions: [], groups: [] };
        const savedLegacy = localStorage.getItem('linkMasterV6');
        if (savedLegacy) {
            try { legacyState = JSON.parse(savedLegacy); } catch(e) {}
        }
        
        profilesData = {
            activeId: 'prof_1',
            profiles: [
                {
                    id: 'prof_1',
                    name: 'Profile 1',
                    state: legacyState
                }
            ]
        };
        saveProfilesData();
    }

    // Ensure every profile has a valid structure and ID
    profilesData.profiles.forEach((p, idx) => {
        if (!p || typeof p !== 'object') {
            profilesData.profiles[idx] = { id: 'prof_' + (idx + 1), name: 'Profile ' + (idx + 1), state: { allLinks: [], sessions: [], groups: [] } };
        } else {
            if (!p.id) p.id = 'prof_' + (idx + 1);
            if (!p.name) p.name = 'Profile ' + (idx + 1);
            if (!p.state) p.state = { allLinks: [], sessions: [], groups: [] };
        }
    });

    let activeProf = profilesData.profiles.find(p => p && p.id === profilesData.activeId);
    if (!activeProf) {
        activeProf = profilesData.profiles[0];
        if (activeProf) {
            profilesData.activeId = activeProf.id;
        } else {
            activeProf = { id: 'prof_1', name: 'Profile 1', state: { allLinks: [], sessions: [], groups: [] } };
            profilesData = { activeId: 'prof_1', profiles: [activeProf] };
            saveProfilesData();
        }
    }

    state = activeProf.state || { allLinks: [], sessions: [], groups: [] };
    if (!state.allLinks) state.allLinks = [];
    if (!state.sessions) state.sessions = [];
    if (!state.groups) state.groups = [];
    state.sessions.forEach(s => { if (s && s.hidden === undefined) s.hidden = false; });
    
    // Purge any extension popup links
    const prevCount = state.allLinks.length;
    state.allLinks = state.allLinks.filter(l => l && l.url && !isIgnoredUrl(l.url));
    if (state.allLinks.length !== prevCount) {
        const validIds = new Set(state.allLinks.map(l => l.id));
        state.sessions.forEach(s => s.linkIds = (s.linkIds || []).filter(id => validIds.has(id)));
        state.groups.forEach(g => g.linkIds = (g.linkIds || []).filter(id => validIds.has(id)));
        saveState();
    }
    
    updateProfileNavBtn();
}

function saveState() {
    if (profilesData && Array.isArray(profilesData.profiles)) {
        let activeProf = profilesData.profiles.find(p => p && p.id === profilesData.activeId);
        if (activeProf) {
            activeProf.state = state;
        }
    }
    saveProfilesData();
    localStorage.setItem('linkMasterV6', JSON.stringify(state));
}

function saveProfilesData() {
    localStorage.setItem('linkMasterProfiles_V1', JSON.stringify(profilesData));
}

function updateProfileNavBtn() {
    const navProf = document.getElementById('nav-profile');
    if (navProf) {
        const activeProf = (profilesData && Array.isArray(profilesData.profiles)) 
            ? profilesData.profiles.find(p => p && String(p.id) === String(profilesData.activeId)) 
            : null;
        const name = activeProf ? activeProf.name : 'Profile 1';
        navProf.innerText = `Profile (${name})`;
    }
}

function downloadFile(filename, content) {
    const element = document.createElement('a');
    element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(content));
    element.setAttribute('download', filename);
    document.body.appendChild(element); element.click(); document.body.removeChild(element);
}

function exportFullState() {
    const date = new Date().toISOString().split('T')[0];
    downloadFile(`linkmaster_backup_${date}.json`, JSON.stringify(state, null, 2));
}

function triggerRestore() { document.getElementById('restoreInput').click(); }

function handleRestoreFile(input) {
    const file = input.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const restoredState = JSON.parse(e.target.result);
            if(restoredState.allLinks && restoredState.sessions) {
                if(confirm("This will overwrite your current links. Continue?")) {
                    state = restoredState;
                    saveState();
                    location.reload();
                }
            } else { alert("Invalid Backup File"); }
        } catch(err) { alert("Error reading file"); }
    };
    reader.readAsText(file);
}

function exportMainLinksTxt() {
    const sessionLinkIds = new Set();
    state.sessions.forEach(s => s.linkIds.forEach(id => sessionLinkIds.add(id)));
    const mainLinks = state.allLinks.filter(l => !sessionLinkIds.has(l.id));
    if(mainLinks.length === 0) return alert("No main links to export.");
    downloadFile('main_links_only.txt', mainLinks.map(l => l.url).join('\n'));
}

function exportAllSessionsTxt() {
    let content = "";
    let hasLinks = false;
    state.sessions.forEach(sess => {
        const sLinks = sess.linkIds.map(id => state.allLinks.find(l=>l.id===id)).filter(l=>l);
        if(sLinks.length > 0) {
            hasLinks = true;
            content += `--- SESSION: ${sess.name} ${sess.hidden?'(Hidden)':''} ---\n`;
            content += sLinks.map(l => l.url).join('\n');
            content += "\n\n";
        }
    });
    if(!hasLinks) return alert("No session links to export.");
    downloadFile('all_sessions_links.txt', content);
}

function exportSessionTxt(id) {
    const sess = state.sessions.find(s => s.id === id);
    if(!sess) return;
    const links = sess.linkIds.map(id => state.allLinks.find(l=>l.id===id)).filter(l=>l);
    if(links.length === 0) return alert("Empty session");
    downloadFile(`${sess.name.replace(/[^a-z0-9]/gi,'_')}.txt`, links.map(l=>l.url).join('\n'));
}

function addLinks(input, sessionId = null) {
    let linkObjects = [];
    if (typeof input === 'string') {
        const lines = input.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !isIgnoredUrl(l));
        linkObjects = lines.map(url => ({ url }));
    } else if (Array.isArray(input)) {
        linkObjects = input.filter(item => item && item.url && !isIgnoredUrl(item.url));
    }
    
    if (linkObjects.length === 0) return;

    let addedIds = [];
    linkObjects.forEach(item => {
        let cleanUrl = item.url;
        if (!cleanUrl.match(/^https?:\/\//i)) cleanUrl = 'https://' + cleanUrl;
        
        let domain = 'unknown';
        try { domain = new URL(cleanUrl).hostname.replace(/^www\./, ''); } catch (e) {}

        const newLink = {
            id: Date.now() + Math.random(),
            url: cleanUrl,
            title: item.title || '',
            domain: domain,
            watched: false,
            timestamp: Date.now(),
            isNew: true
        };

        state.allLinks.unshift(newLink);
        addedIds.push(newLink.id);
    });

    if (sessionId) {
        const targetSession = state.sessions.find(s => s.id === sessionId);
        if (targetSession) {
            targetSession.linkIds.unshift(...addedIds);
        }
    }

    saveState();
    renderAll();
}

function createNewSession() {
    showInputModal('Create New Session', 'Session Name...', '', false, (name) => {
        if(name && name.trim()) {
            state.sessions.unshift({ id: Date.now(), name: name.trim(), expanded: true, hidden: false, linkIds: [] });
            saveState(); renderSessions();
        }
    });
}

function toggleWatch(id) {
    const link = state.allLinks.find(l => l.id === id);
    if(link) {
        link.watched = !link.watched;
        link.isNew = false;
        saveState();
        renderAll();
    }
}

function deleteGlobalLink(id) {
    state.allLinks = state.allLinks.filter(l => l.id !== id);
    state.sessions.forEach(s => s.linkIds = s.linkIds.filter(lid => lid !== id));
    state.groups.forEach(g => g.linkIds = g.linkIds.filter(lid => lid !== id));
    saveState(); renderAll();
}

function removeDuplicates() {
    const seen = new Set();
    const unique = [];
    state.allLinks.forEach(l => {
        if (!seen.has(l.url)) {
            seen.add(l.url);
            unique.push(l);
        }
    });
    const removedCount = state.allLinks.length - unique.length;
    state.allLinks = unique;
    const validIds = new Set(unique.map(l => l.id));
    state.sessions.forEach(s => s.linkIds = s.linkIds.filter(id => validIds.has(id)));
    state.groups.forEach(g => g.linkIds = g.linkIds.filter(id => validIds.has(id)));
    saveState();
    renderAll();
    showModal('Cleanup Complete', `Removed ${removedCount} duplicate links.`, () => {}, false);
}

function generateGroups() {
    const sizeInput = document.getElementById('groupSize');
    const size = parseInt(sizeInput.value) || 2;
    const hiddenIds = new Set(); state.sessions.forEach(s=>{if(s.hidden)s.linkIds.forEach(id=>hiddenIds.add(id))});
    const unwatched = state.allLinks.filter(l => !l.watched && !hiddenIds.has(l.id));

    if (unwatched.length === 0) return showModal('Shuffle Groups', 'No unwatched visible links available to group.', () => {}, false);

    const shuffled = [...unwatched];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const ids = shuffled.map(l => l.id);
    const numGroups = Math.ceil(ids.length / size);
    state.groups = [];
    for (let i = 0; i < numGroups; i++) {
        state.groups.push({ id: Date.now() + i, name: `Group ${i + 1}`, expanded: true, linkIds: [] });
    }
    ids.forEach((id,i) => state.groups[i%size].linkIds.push(id));
    state.groups = state.groups.filter(g=>g.linkIds.length>0);
    saveState(); renderGroups(); switchView('groups');
}

function toggleAccordion(type, id) {
    const item = type==='session' ? state.sessions.find(x=>x.id===id) : state.groups.find(x=>x.id===id);
    if(item) { item.expanded = !item.expanded; saveState(); type==='session'?renderSessions():renderGroups(); }
}

function showModal(title, desc, confirmCallback, showConfirmBtn = true) {
    document.getElementById('modalTitle').innerText = title;
    document.getElementById('modalDesc').innerText = desc;
    document.getElementById('modalInput').style.display = 'none';
    document.getElementById('modalTextarea').style.display = 'none';
    const confirmBtn = document.getElementById('modalConfirmBtn');
    confirmBtn.style.display = showConfirmBtn ? 'inline-block' : 'none';
    confirmBtn.style.background = 'var(--danger)';
    confirmBtn.style.borderColor = 'var(--danger)';
    confirmBtn.innerText = 'Confirm';
    confirmBtn.onclick = () => { confirmCallback(); closeModal(); };
    document.getElementById('customModal').style.display = 'flex';
}

function showInputModal(title, placeholder, initialValue, isTextarea, onConfirm) {
    document.getElementById('modalTitle').innerText = title;
    document.getElementById('modalDesc').innerText = '';
    const input = document.getElementById('modalInput');
    const textarea = document.getElementById('modalTextarea');
    
    if (isTextarea) {
        input.style.display = 'none';
        textarea.style.display = 'block';
        textarea.value = initialValue || '';
        textarea.placeholder = placeholder || '';
        setTimeout(() => textarea.focus(), 50);
    } else {
        textarea.style.display = 'none';
        input.style.display = 'block';
        input.value = initialValue || '';
        input.placeholder = placeholder || '';
        setTimeout(() => input.focus(), 50);
    }

    const confirmBtn = document.getElementById('modalConfirmBtn');
    confirmBtn.style.display = 'inline-block';
    confirmBtn.style.background = 'var(--accent)';
    confirmBtn.style.borderColor = 'var(--accent)';
    confirmBtn.innerText = 'Save';
    
    confirmBtn.onclick = () => {
        const val = isTextarea ? textarea.value : input.value;
        onConfirm(val);
        closeModal();
    };
    
    document.getElementById('customModal').style.display = 'flex';
}

function closeModal() {
    document.getElementById('customModal').style.display = 'none';
    const input = document.getElementById('modalInput');
    input.style.display = 'none';
    input.disabled = false;
    input.style.opacity = '1';
    document.getElementById('modalTextarea').style.display = 'none';
    const cancelBtn = document.getElementById('modalCancelBtn');
    if (cancelBtn) cancelBtn.innerText = 'Cancel';
    const customContent = document.getElementById('modalCustomContent');
    if (customContent) {
        customContent.style.display = 'none';
        customContent.innerHTML = '';
    }
}

function showSaveTabsModal(tabsList) {
    document.getElementById('modalTitle').innerText = 'Save All Tabs';
    document.getElementById('modalDesc').innerText = 'Save open tabs to a new session or select an existing session below:';
    
    const input = document.getElementById('modalInput');
    const textarea = document.getElementById('modalTextarea');
    const customContent = document.getElementById('modalCustomContent');
    
    textarea.style.display = 'none';
    input.style.display = 'block';
    input.disabled = false;
    input.style.opacity = '1';
    
    const now = new Date();
    const defaultTime = now.toLocaleDateString('en-US',{month:'short',day:'2-digit'}) + " " + now.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
    input.value = defaultTime;
    input.placeholder = 'New Session Name...';
    
    let tableHTML = '';
    if (state.sessions.length > 0) {
        let rows = state.sessions.map(s => {
            const d = new Date(s.id);
            const createdStr = isNaN(d.getTime()) ? 'Existing' : d.toLocaleDateString('en-US',{month:'short',day:'2-digit'}) + " " + d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
            return `
                <tr style="border-b:1px solid #27272a; color:#f4f4f5; font-size:0.8rem;">
                    <td style="padding:6px 8px; text-align:center;">
                        <input type="checkbox" class="save-tab-session-cb" data-id="${s.id}" style="accent-color:var(--accent); cursor:pointer;">
                    </td>
                    <td style="padding:6px 8px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:140px;">${s.name}</td>
                    <td style="padding:6px 8px; text-align:center; color:#a1a1aa;">${s.linkIds ? s.linkIds.length : 0}</td>
                    <td style="padding:6px 8px; text-align:right; color:#71717a; font-size:0.75rem; white-space:nowrap;">${createdStr}</td>
                </tr>
            `;
        }).join('');
        
        tableHTML = `
            <div style="margin-top:12px; margin-bottom:6px; font-size:0.8rem; font-weight:600; color:#a1a1aa;">Or select an existing session:</div>
            <div style="max-height:130px; overflow-y:auto; border:1px solid #27272a; border-radius:8px; background:#09090b; margin-bottom:14px;">
                <table style="width:100%; border-collapse:collapse; text-align:left;">
                    <thead>
                        <tr style="border-b:1px solid #27272a; background:#121215; color:#a1a1aa; font-size:0.75rem;">
                            <th style="padding:6px 8px; width:30px; text-align:center;">Select</th>
                            <th style="padding:6px 8px;">Session</th>
                            <th style="padding:6px 8px; width:45px; text-align:center;">Links</th>
                            <th style="padding:6px 8px; width:95px; text-align:right;">Created</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows}
                    </tbody>
                </table>
            </div>
        `;
    } else {
        tableHTML = `<div style="margin-top:10px; margin-bottom:14px; font-size:0.85rem; color:#71717a; text-align:center;">No existing sessions found.</div>`;
    }
    
    // LIST OF ALL TABS BOX
    let tabRows = tabsList.map(t => {
        let domain = 'unknown';
        try { domain = new URL(t.url).hostname.replace(/^www\./, ''); } catch(e){}
        const fav = (domain && domain.includes('.')) ? `https://icons.duckduckgo.com/ip3/${domain}.ico` : (t.favIconUrl || DEFAULT_ICON);
        const titleText = t.title || domain || t.url;
        const isDupe = state.allLinks.some(l => l.url === t.url);
        
        return `
            <div class="save-tab-row ${isDupe ? 'is-dupe' : ''}" style="display:${isDupe ? 'none' : 'flex'}; align-items:center; gap:8px; padding:6px 8px; border-bottom:1px solid #27272a; background:#121215;">
                <input type="checkbox" class="save-tab-item-cb" data-tab-id="${t.id || ''}" data-url="${t.url}" ${isDupe ? '' : 'checked'} style="accent-color:var(--accent); cursor:pointer;">
                <img src="${fav}" style="width:16px; height:16px; border-radius:4px; object-fit:contain;" onerror="this.onerror=null;this.src='${DEFAULT_ICON}'">
                <div style="flex-grow:1; overflow:hidden; text-align:left;">
                    <div style="font-size:0.78rem; font-weight:600; color:#f4f4f5; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${titleText}</div>
                    <div style="font-size:0.7rem; color:#a1a1aa; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${t.url}</div>
                </div>
            </div>
        `;
    }).join('');

    const tabsBoxHTML = `
        <div style="margin-top:6px; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center;">
            <div style="font-size:0.8rem; font-weight:600; color:#a1a1aa;">List of all tabs:</div>
            <div style="display:flex; align-items:center; gap: 10px;">
                <span id="dupMsgSave" style="color:var(--warning); font-size:0.7rem; display:none;"></span>
                <label style="font-size:0.75rem; color:#a1a1aa; cursor:pointer; user-select:none; display:flex; align-items:center; gap:4px;">
                    <input type="checkbox" id="cbHideDupSave" checked style="accent-color:var(--accent); margin:0;"> Hide Duplicates
                </label>
                <button id="btnClearDupSave" class="mini-btn" style="background:transparent; border:1px solid #3f3f4e; color:#a1a1aa; padding: 2px 6px;">Clear Dupes</button>
                <label style="font-size:0.75rem; color:#8b5cf6; cursor:pointer; user-select:none; display:flex; align-items:center; gap:4px;">
                    <input type="checkbox" id="toggleAllSaveTabs" checked style="accent-color:var(--accent); margin:0;"> Select All
                </label>
            </div>
        </div>
        <div style="max-height:160px; overflow-y:auto; border:1px solid #27272a; border-radius:8px; background:#09090b;">
            ${tabRows}
        </div>
    `;
    
    customContent.innerHTML = tableHTML + tabsBoxHTML;
    customContent.style.display = 'block';

    const toggleAll = customContent.querySelector('#toggleAllSaveTabs');
    if (toggleAll) {
        toggleAll.addEventListener('change', (e) => {
            customContent.querySelectorAll('.save-tab-item-cb').forEach(cb => {
                const row = cb.closest('.save-tab-row');
                if (row && row.style.display === 'none') return;
                cb.checked = e.target.checked;
            });
        });
    }

    const cbHideDup = customContent.querySelector('#cbHideDupSave');
    if (cbHideDup) {
        cbHideDup.addEventListener('change', (e) => {
            const hide = e.target.checked;
            customContent.querySelectorAll('.save-tab-row.is-dupe').forEach(row => {
                row.style.display = hide ? 'none' : 'flex';
                if (hide) {
                    const cb = row.querySelector('.save-tab-item-cb');
                    if (cb) cb.checked = false;
                }
            });
        });
    }

    const btnClearDup = customContent.querySelector('#btnClearDupSave');
    const dupMsg = customContent.querySelector('#dupMsgSave');
    if (btnClearDup) {
        btnClearDup.addEventListener('click', (e) => {
            e.preventDefault();
            let unselectedCount = 0;
            customContent.querySelectorAll('.save-tab-item-cb').forEach(cb => {
                const url = cb.getAttribute('data-url');
                const isDupe = state.allLinks.some(l => l.url === url);
                if (isDupe && cb.checked) {
                    cb.checked = false;
                    unselectedCount++;
                }
            });
            dupMsg.innerText = `${unselectedCount} duplicate videos unselected`;
            dupMsg.style.display = 'inline';
            setTimeout(() => dupMsg.style.display = 'none', 3000);
        });
    }

    const cbs = customContent.querySelectorAll('.save-tab-session-cb');
    cbs.forEach(cb => {
        cb.addEventListener('change', (e) => {
            if (e.target.checked) {
                cbs.forEach(other => { if (other !== e.target) other.checked = false; });
                input.disabled = true;
                input.style.opacity = '0.5';
            } else {
                input.disabled = false;
                input.style.opacity = '1';
            }
        });
    });

    const confirmBtn = document.getElementById('modalConfirmBtn');
    confirmBtn.style.display = 'inline-block';
    confirmBtn.style.background = 'var(--accent)';
    confirmBtn.style.borderColor = 'var(--accent)';
    confirmBtn.innerText = 'Save Tabs';
    
    confirmBtn.onclick = () => {
        const checkedItemCbs = customContent.querySelectorAll('.save-tab-item-cb:checked');
        if (checkedItemCbs.length === 0) {
            alert('Please select at least one tab to save.');
            return;
        }

        const selectedTabs = Array.from(checkedItemCbs).map(cb => {
            const url = cb.getAttribute('data-url');
            const tabId = cb.getAttribute('data-tab-id');
            const tab = tabsList.find(t => (tabId && t.id == tabId) || t.url === url);
            return { url: url, title: tab ? tab.title : '' };
        });

        const selectedTabIds = Array.from(checkedItemCbs)
            .map(cb => cb.getAttribute('data-tab-id'))
            .filter(id => id && id !== 'undefined' && id !== 'null')
            .map(Number);
            
        const selectedCb = customContent.querySelector('.save-tab-session-cb:checked');
        let targetSessionId = null;
        
        if (selectedCb) {
            targetSessionId = parseFloat(selectedCb.getAttribute('data-id'));
        } else {
            const newName = input.value.trim() || defaultTime;
            targetSessionId = Date.now();
            state.sessions.unshift({ id: targetSessionId, name: newName, expanded: true, hidden: false, linkIds: [] });
        }
        
        addLinks(selectedTabs, targetSessionId);
        closeModal();
        switchView('sessions');
        renderSessions();

        showCloseTabsPrompt(selectedTabIds, selectedTabs.length);
    };

    document.getElementById('customModal').style.display = 'flex';
}

function showCloseTabsPrompt(tabIdsToClose, savedCount) {
    showModal(
        'Close Saved Tabs?',
        `Do you want to close the ${savedCount} selected tab(s) that were just saved?`,
        () => {
            if (tabIdsToClose && tabIdsToClose.length > 0 && typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.remove) {
                chrome.tabs.remove(tabIdsToClose);
            }
        },
        true
    );
    const confirmBtn = document.getElementById('modalConfirmBtn');
    const cancelBtn = document.getElementById('modalCancelBtn');
    if (confirmBtn) {
        confirmBtn.innerText = 'Yes';
        confirmBtn.style.background = 'var(--danger)';
        confirmBtn.style.borderColor = 'var(--danger)';
    }
    if (cancelBtn) {
        cancelBtn.innerText = 'No';
    }
}

function confirmDeleteSessionLink(sessionId, linkId) {
    showModal('Delete Link?', 'Do you really want to delete this link?', () => {
        const session = state.sessions.find(s => s.id === sessionId);
        if (session) session.linkIds = session.linkIds.filter(id => id !== linkId);
        deleteGlobalLink(linkId);
    });
}

function updateMergeUI() {
    const checked = document.querySelectorAll('.session-merge-cb:checked');
    const countEl = document.getElementById('mergeCount');
    if (countEl) countEl.innerText = checked.length;
}

function confirmMergeSessions() {
    const checked = Array.from(document.querySelectorAll('.session-merge-cb:checked')).map(cb => parseInt(cb.getAttribute('data-id')));
    if(checked.length < 2) {
        showModal('Merge Sessions', 'Please check at least 2 sessions to merge.', () => {}, false);
        return;
    }
    showModal('Merge Sessions?', `Merge ${checked.length} selected sessions into a single session?`, () => {
        const mergedLinkIds = new Set();
        checked.forEach(id => {
            const session = state.sessions.find(s => s.id === id);
            if(session) session.linkIds.forEach(linkId => mergedLinkIds.add(linkId));
        });
        state.sessions = state.sessions.filter(s => !checked.includes(s.id));
        const newId = Date.now();
        state.sessions.unshift({ id: newId, name: "Merged Session", expanded: true, hidden: false, linkIds: Array.from(mergedLinkIds) });
        saveState();
        renderSessions();
        updateMergeUI();
    });
}

function confirmDeleteGroup(id) {
    showModal('Delete Group?', 'Are you sure you want to permanently delete this group?', () => {
        state.groups = state.groups.filter(g => g.id !== id);
        saveState(); renderGroups();
    });
}

function confirmDeleteSession(id) {
    showModal('Delete Session?', 'Are you sure you want to delete this session and permanently remove all links that belong exclusively to it?', () => {
        const s = state.sessions.find(x => x.id === id);
        if(s) {
            const exclusive = s.linkIds.filter(lid => !state.sessions.some(other=>other.id!==id && other.linkIds.includes(lid)));
            exclusive.forEach(deleteGlobalLink);
        }
        state.sessions = state.sessions.filter(s => s.id !== id);
        if(state.sessions.length === 0) createNewSession();
        saveState(); renderAll();
    });
}

function deleteDoneLinks() {
    const doneLinks = state.allLinks.filter(l => l.watched);
    if (doneLinks.length === 0) {
        return showModal('Delete Done Links', 'No done (checked) links found to delete.', () => {}, false);
    }
    showModal(
        'Delete Done Links?',
        `Are you sure you want to delete all ${doneLinks.length} done link(s)?`,
        () => {
            const doneIds = new Set(doneLinks.map(l => l.id));
            state.allLinks = state.allLinks.filter(l => !doneIds.has(l.id));
            state.sessions.forEach(s => {
                s.linkIds = s.linkIds.filter(id => !doneIds.has(id));
            });
            state.groups.forEach(g => {
                g.linkIds = g.linkIds.filter(id => !doneIds.has(id));
            });
            saveState();
            renderAll();
            showToast(`Deleted ${doneLinks.length} done link(s).`);
        },
        true
    );
}

function deleteDoneSessionLinks(sessionId) {
    const session = state.sessions.find(s => s.id === sessionId);
    if (!session) return;
    const doneLinks = session.linkIds
        .map(id => state.allLinks.find(l => l.id === id))
        .filter(l => l && l.watched);
        
    if (doneLinks.length === 0) {
        return showModal('Delete Done Links', 'No done links found in this session.', () => {}, false);
    }
    
    showModal(
        'Delete Session Done Links?',
        `Delete ${doneLinks.length} done link(s) from "${session.name}"?`,
        () => {
            const doneIds = new Set(doneLinks.map(l => l.id));
            session.linkIds = session.linkIds.filter(id => !doneIds.has(id));
            const activeSessionLinkIds = new Set(state.sessions.flatMap(s => s.linkIds));
            state.allLinks = state.allLinks.filter(l => !doneIds.has(l.id) || activeSessionLinkIds.has(l.id));
            saveState();
            renderAll();
            showToast(`Deleted ${doneLinks.length} done link(s) from session.`);
        },
        true
    );
}

function promptAdd(sid) {
    const session = state.sessions.find(s => s.id === sid);
    const sessionName = session ? session.name : 'Session';
    showInputModal(`Add Links to ${sessionName}`, 'Paste URLs here (one per line)...', '', true, (val) => {
        if (val && val.trim()) addLinks(val, sid);
    });
}

function editSessionName(id) {
    const s = state.sessions.find(x => x.id === id);
    if (!s) return;
    showInputModal('Rename Session', 'Session name...', s.name, false, (val) => {
        if (val && val.trim()) {
            s.name = val.trim();
            saveState();
            renderSessions();
        }
    });
}

function toggleSessionVisibility(id) {
    const s = state.sessions.find(x=>x.id===id);
    s.hidden = !s.hidden; saveState(); renderAll();
}

function openContainerLinks(ids) {
    const urls = ids.map(id=>state.allLinks.find(l=>l.id===id)).filter(l=>l&&!l.watched).map(l=>l.url);
    if(urls.length===0) return alert("No active links");
    if(urls.length>10 && !confirm(`Open ${urls.length} tabs?`)) return;
    urls.forEach(u=>chrome.tabs.create({ url: u, active: false }));
}

function closeContainerLinks(ids) {
    const urls = ids.map(id => state.allLinks.find(l => l.id === id)).filter(l => l).map(l => l.url);
    if (urls.length === 0) return showModal('Close Links', 'No links found in this container.', () => {}, false);
    
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query && chrome.tabs.remove) {
        chrome.tabs.query({}, (tabs) => {
            const tabsToClose = tabs.filter(t => {
                const tabUrl = t.pendingUrl || t.url;
                return tabUrl && urls.some(u => isUrlMatch(tabUrl, u));
            });
            if (tabsToClose.length === 0) {
                showModal('Close Links', 'No open browser tabs matching links in this session/group.', () => {}, false);
                return;
            }
            const tabIds = tabsToClose.map(t => t.id);
            chrome.tabs.remove(tabIds);
        });
    } else {
        showModal('Close Links', 'Tab management requires browser extension context.', () => {}, false);
    }
}

async function matchSessionLinks(sessionId) {
    const s = state.sessions.find(x => x.id === sessionId);
    if (!s) return;
    if (!s.opened) {
        showToast('Please click Open or a link first to enable Match!');
        return;
    }

    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
        chrome.tabs.query({}, (tabs) => {
            const openUrls = (tabs || []).map(t => t.pendingUrl || t.url).filter(Boolean);
            let doneCount = 0;

            s.linkIds.forEach(linkId => {
                const link = state.allLinks.find(l => l.id === linkId);
                if (!link) return;
                // Only check links that were actually opened by the user
                if (!link.tabOpened) return;

                const isOpen = openUrls.some(u => isUrlMatch(u, link.url));
                if (!isOpen) {
                    // Tab was opened and is now closed = manually closed by user
                    if (!link.watched) doneCount++;
                    link.watched = true;
                    link.isNew = false;
                    link.tabOpened = false;
                }
                // If still open, leave it as-is (not done yet)
            });

            saveState();
            renderAll();
            showToast(`Match complete! ${doneCount} closed link(s) marked as done.`);
        });
    } else {
        showModal('Match Session', 'Tab matching requires browser extension context with tabs permission.', () => {}, false);
    }
}

function parseUrlHelper(urlStr) {
    if (!urlStr || typeof urlStr !== 'string') return null;
    let str = urlStr.trim();
    if (!str.match(/^https?:\/\//i)) {
        str = 'https://' + str;
    }
    try {
        const u = new URL(str);
        let host = u.hostname.toLowerCase().replace(/^www\./, '');
        if (host === 'twitter.com') host = 'x.com';
        
        let path = u.pathname.replace(/\/+$/, '');
        if (!path) path = '/';
        
        const params = {};
        u.searchParams.forEach((value, key) => {
            const lowerKey = key.toLowerCase();
            const trackingParams = new Set([
                'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
                'fbclid', 'gclid', 'msclkid', 'ref', 'ref_src', 'feature', 'si', 'mbid', 'mc_cid', 'mc_eid'
            ]);
            if (!trackingParams.has(lowerKey) && !lowerKey.startsWith('utm_')) {
                params[lowerKey] = value;
            }
        });
        
        return { host, path, params, rawUrl: str };
    } catch(e) {
        return null;
    }
}

function isUrlMatch(url1, url2) {
    if (!url1 || !url2) return false;
    if (url1 === url2) return true;
    
    const p1 = parseUrlHelper(url1);
    const p2 = parseUrlHelper(url2);
    
    if (!p1 || !p2) {
        const s1 = url1.toLowerCase().replace(/\/+$/, '');
        const s2 = url2.toLowerCase().replace(/\/+$/, '');
        return s1 === s2 || s1.includes(s2) || s2.includes(s1);
    }
    
    if (p1.host !== p2.host) return false;
    
    const pathMatch = (p1.path === p2.path) || 
                      (p1.path !== '/' && p2.path !== '/' && (p1.path.startsWith(p2.path + '/') || p2.path.startsWith(p1.path + '/')));
    if (!pathMatch) return false;
    
    const keys1 = Object.keys(p1.params);
    const keys2 = Object.keys(p2.params);
    
    if (keys2.length > 0) {
        for (const k of keys2) {
            if (p1.params[k] !== p2.params[k]) return false;
        }
    } else if (keys1.length > 0) {
        for (const k of keys1) {
            if (p2.params[k] !== undefined && p1.params[k] !== p2.params[k]) return false;
        }
    }
    
    return true;
}

function toggleSidebarMinimize() {
    const sidebar = document.getElementById('profilesSidebar');
    const layout = document.querySelector('.app-layout');
    if (!sidebar || !layout) return;
    const isCollapsed = sidebar.classList.toggle('collapsed');
    layout.classList.toggle('sidebar-collapsed', isCollapsed);
    localStorage.setItem('sidebarCollapsed_V1', isCollapsed ? 'true' : 'false');
}

function setSidebarMinimized(collapsed) {
    const sidebar = document.getElementById('profilesSidebar');
    const layout = document.querySelector('.app-layout');
    if (!sidebar || !layout) return;
    if (collapsed) {
        sidebar.classList.add('collapsed');
        layout.classList.add('sidebar-collapsed');
    } else {
        sidebar.classList.remove('collapsed');
        layout.classList.remove('sidebar-collapsed');
    }
}

function toggleSidebarDrawer() {
    const sidebar = document.getElementById('profilesSidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (sidebar) sidebar.classList.toggle('open');
    if (overlay) overlay.classList.toggle('active');
}

function closeSidebarDrawer() {
    const sidebar = document.getElementById('profilesSidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('active');
}

function renderSidebarProfiles() {
    const container = document.getElementById('sidebarProfilesList');
    if (!container || !profilesData || !Array.isArray(profilesData.profiles)) return;

    container.innerHTML = profilesData.profiles.map(p => {
        const isActive = p.id === profilesData.activeId;
        const linkCount = p.state && p.state.allLinks ? p.state.allLinks.length : 0;
        const sessionCount = p.state && p.state.sessions ? p.state.sessions.length : 0;
        const initials = p.name ? p.name.trim().charAt(0).toUpperCase() : 'P';

        return `
            <div class="sidebar-prof-item ${isActive ? 'active' : ''}" data-id="${p.id}" title="${isActive ? 'Active Profile (Double-click name to rename)' : 'Click to switch profile'}">
                <div class="sidebar-prof-avatar ${isActive ? 'active-avatar' : ''}">
                    ${initials}
                </div>
                <div class="sidebar-prof-info">
                    <div class="sidebar-prof-name-row">
                        <span class="sidebar-prof-name" data-id="${p.id}">${p.name}</span>
                    </div>
                    <div class="sidebar-prof-meta">
                        ${linkCount} link${linkCount === 1 ? '' : 's'} • ${sessionCount} session${sessionCount === 1 ? '' : 's'}
                    </div>
                </div>
                ${profilesData.profiles.length > 1 ? `
                    <button class="sidebar-prof-del-btn" data-id="${p.id}" title="Delete Profile">
                        &times;
                    </button>
                ` : ''}
            </div>
        `;
    }).join('');

    container.querySelectorAll('.sidebar-prof-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.closest('.sidebar-prof-del-btn')) return;
            const id = item.getAttribute('data-id');
            switchProfile(id);
            closeSidebarDrawer();
        });
    });

    container.querySelectorAll('.sidebar-prof-name').forEach(span => {
        span.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            span.classList.add('dblclick-animate');
            setTimeout(() => {
                const id = span.getAttribute('data-id');
                renameProfile(id);
            }, 180);
        });
    });

    container.querySelectorAll('.sidebar-prof-del-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.getAttribute('data-id');
            deleteProfile(id);
        });
    });
}

function renderAll() { 
    updateProfileNavBtn();
    renderSidebarProfiles(); 
    renderHome(); 
    renderSessions(); 
    renderGroups(); 
    renderExport(); 
}

function renderHome() {
    const container = document.getElementById('stackContainer');
    const counter = document.getElementById('stackCounter');
    const sort = document.getElementById('sortMode').value;
    container.innerHTML = '';

    const hiddenIds = new Set(); state.sessions.forEach(s=>{if(s.hidden)s.linkIds.forEach(id=>hiddenIds.add(id))});
    const visible = state.allLinks.filter(l=>!hiddenIds.has(l.id));
    
    counter.innerText = `${visible.filter(l=>!l.watched).length} active / ${visible.length}`;
    if(visible.length===0) return container.innerHTML='<div style="padding:20px;text-align:center;color:#555">No visible links</div>';

    let sorted = [...visible];
    if(sort==='new') sorted.sort((a,b)=>b.timestamp-a.timestamp);
    else if(sort==='checked') sorted.sort((a,b)=>b.watched-a.watched);
    else if(sort==='unchecked') sorted.sort((a,b)=>a.watched-b.watched);
    else if(sort==='random') for(let i=sorted.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[sorted[i],sorted[j]]=[sorted[j],sorted[i]];}

    sorted.forEach(l => {
        const fav = (l.domain&&l.domain.includes('.')) ? `https://icons.duckduckgo.com/ip3/${l.domain}.ico` : DEFAULT_ICON;
        const div = document.createElement('div');
        div.className = `stack-row ${l.watched?'watched':''}`;
        div.innerHTML = `
            <input type="checkbox" class="checkbox-custom" ${l.watched?'checked':''} data-action="toggleWatch" data-id="${l.id}">
            <img src="${fav}" class="stack-favicon" onerror="this.onerror=null;this.src='${DEFAULT_ICON}'">
            <a href="${l.url}" target="_blank" class="stack-link" data-action="toggleWatch" data-id="${l.id}" title="${l.title ? l.title.replace(/"/g, '&quot;') : ''}">${l.title || l.url}</a>
            ${(l.isNew&&!l.watched)?`<span class="badge-new" data-action="toggleWatch" data-id="${l.id}">NEW</span>`:''}
            <button class="mini-btn btn-danger" data-action="deleteGlobalLink" data-id="${l.id}">×</button>
        `;
        container.appendChild(div);
    });
}

function renderSessions() {
    const c = document.getElementById('sessionsContainer'); c.innerHTML='';
    state.sessions.forEach(s => {
        const links = s.linkIds.map(id=>state.allLinks.find(l=>l.id===id)).filter(l=>l);
        const sortedLinks = [...links].sort((a, b) => (a.watched ? 1 : 0) - (b.watched ? 1 : 0));
        const active = links.filter(l=>!l.watched).length;
        const div = document.createElement('div');
        div.className = `accordion-item ${s.expanded?'expanded':''} ${s.hidden?'is-hidden':''}`;
        div.setAttribute('data-drop-zone', 'true');
        div.setAttribute('data-session-id', s.id);
        const isMatchEnabled = !!s.opened;
        div.innerHTML = `
            <div class="accordion-header session-header-layout" data-action="toggleAccordionSession" data-id="${s.id}">
                <div class="header-left">
                    <input type="checkbox" class="session-merge-cb checkbox-custom" data-id="${s.id}" style="margin-right:10px;">
                    <svg class="arrow-icon"><use href="#icon-arrow"></use></svg>
                    <span class="header-title">${s.name} ${s.hidden?'<small style="color:var(--warning)">[HIDDEN]</small>':''}</span>
                    <span class="header-meta">(${active})</span>
                </div>
                <div class="header-actions">
                    <button class="mini-btn btn-save" data-action="exportSessionTxt" data-id="${s.id}"><svg class="icon-svg"><use href="#icon-save"></use></svg></button>
                    <button class="mini-btn btn-hide" data-action="toggleSessionVisibility" data-id="${s.id}"><svg class="icon-svg"><use href="#${s.hidden?'icon-eye-off':'icon-eye'}"></use></svg></button>
                    <button class="mini-btn btn-danger" data-action="closeContainerLinks" data-session-id="${s.id}" data-ids="${s.linkIds.join(',')}">Close</button>
                    <button class="mini-btn btn-match ${isMatchEnabled ? '' : 'disabled'}" data-action="matchSessionLinks" data-id="${s.id}" title="${isMatchEnabled ? 'Match open browser tabs against session links' : 'Click Open or a link first to enable Match'}">Match</button>
                    <button class="mini-btn btn-open-all" data-action="openContainerLinks" data-session-id="${s.id}" data-ids="${s.linkIds.join(',')}">Open</button>
                    <button class="mini-btn btn-danger" data-action="deleteDoneSessionLinks" data-id="${s.id}" title="Delete all done links in this session">Clear Done</button>
                    <button class="mini-btn" data-action="renameSession" data-id="${s.id}">Edit</button>
                    <button class="mini-btn btn-danger" data-action="deleteSession" data-id="${s.id}">Del</button>
                </div>
            </div>
            <div class="accordion-content"><div class="accordion-inner-padding"><div class="cards-grid" data-drop-zone="true" data-session-id="${s.id}">
                <div class="link-card" style="border-style:dashed; border-color:#333; justify-content:center; opacity:0.6; cursor:pointer;" data-action="promptAdd" data-id="${s.id}"><div>+ Add Link</div></div>
                ${sortedLinks.map(l=>createCardHTML(l, s.id)).join('')}
            </div></div></div>
        `;
        c.appendChild(div);
    });
}

function renderGroups() {
    const c = document.getElementById('groupsContainer'); c.innerHTML='';
    
    const hiddenIds = new Set(); state.sessions.forEach(s=>{if(s.hidden)s.linkIds.forEach(id=>hiddenIds.add(id))});
    const vGroups = state.groups.map(g=>({...g, linkIds:g.linkIds.filter(id=>!hiddenIds.has(id))})).filter(g=>g.linkIds.length>0);

    if(vGroups.length===0) return c.innerHTML='<div style="text-align:center;color:#555;padding:20px">No visible groups</div>';
    
    vGroups.forEach(g => {
        const links = g.linkIds.map(id=>state.allLinks.find(l=>l.id===id)).filter(l=>l);
        const div = document.createElement('div');
        div.className = `accordion-item ${state.groups.find(x=>x.id===g.id).expanded?'expanded':''}`;
        div.innerHTML = `
            <div class="accordion-header" data-action="toggleAccordionGroup" data-id="${g.id}">
                <div class="header-left"><svg class="arrow-icon"><use href="#icon-arrow"></use></svg><span class="header-title">${g.name}</span></div>
                <div class="header-actions">
                    <button class="mini-btn btn-danger" data-action="closeContainerLinks" data-ids="${g.linkIds.join(',')}">Close</button>
                    <button class="mini-btn btn-open-all" data-action="openContainerLinks" data-ids="${g.linkIds.join(',')}">Open All</button>
                    <button class="mini-btn btn-danger btn-delete-group" data-action="deleteGroup" data-id="${g.id}">Del</button>
                </div>
            </div>
            <div class="accordion-content"><div class="accordion-inner-padding"><div class="cards-grid">${links.map(l=>createCardHTML(l)).join('')}</div></div></div>
        `;
        c.appendChild(div);
    });
}

function renderExport() {
    const l = document.getElementById('exportSessionList'); l.innerHTML='';
    state.sessions.forEach(s => {
        const row = document.createElement('div'); row.className='export-row';
        row.innerHTML = `<span class="export-name">${s.name}</span><div style="display:flex;align-items:center;"><span class="export-count">${s.linkIds.length}</span><button class="mini-btn" data-action="exportSessionTxt" data-id="${s.id}">.txt</button></div>`;
        l.appendChild(row);
    });
}

function createCardHTML(l, sessionId = null) {
    const fav = (l.domain&&l.domain.includes('.')) ? `https://icons.duckduckgo.com/ip3/${l.domain}.ico` : DEFAULT_ICON;
    const deleteBtn = sessionId ? `<button class="mini-btn btn-danger btn-delete-group" data-action="deleteSessionLink" data-session-id="${sessionId}" data-id="${l.id}" title="Delete link"><svg class="icon-svg" style="width:13px; height:13px;"><use href="#icon-trash"></use></svg></button>` : '';
    const displayName = l.title ? l.title : l.domain.toUpperCase();
    const tooltip = l.title ? l.title.replace(/"/g, '&quot;') : '';
    const sessionAttr = sessionId ? `data-session-id="${sessionId}"` : '';
    const dragAttrs = sessionId ? `draggable="true" data-action-dragstart="handleDragStart" data-link-id="${l.id}"` : '';
    return `
        <div class="link-card ${l.watched?'watched':''}" data-action="cardClick" data-url="${l.url}" ${sessionAttr} ${dragAttrs}>
            <div class="card-icon"><img src="${fav}" onerror="this.onerror=null;this.src='${DEFAULT_ICON}'"></div>
            <div class="card-info"><div class="card-title" title="${tooltip}">${displayName}</div><div class="card-desc">${l.url}</div></div>
            <div class="card-actions">
                ${deleteBtn}
                <button class="mini-btn ${l.watched?'':'primary'}" data-action="toggleWatch" data-id="${l.id}">${l.watched?'Undo':'Done'}</button>
            </div>
        </div>
    `;
}

function switchView(v) {
    document.querySelectorAll('main').forEach(e=>e.classList.remove('active-view'));
    document.querySelectorAll('.nav-item').forEach(e=>e.classList.remove('active'));
    document.getElementById(`view-${v}`).classList.add('active-view');
    const m={'home':0,'sessions':1,'groups':2,'export':3};
    if(m[v]!==undefined) document.querySelectorAll('.nav-item')[m[v]].classList.add('active');
}

function handleHomePaste(){ const b=document.getElementById('homePaste'); if(b.value.trim()){addLinks(b.value);b.value='';} }

async function promptAdd(sid) {
    let tabsList = [];
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
        const tabs = await chrome.tabs.query({});
        tabsList = tabs.filter(t => t.url && !isIgnoredUrl(t.url));
    }
        
    if (tabsList.length === 0) {
        const dummyUrl = window.location.href;
        if (!isIgnoredUrl(dummyUrl)) {
            tabsList = [{ id: null, url: dummyUrl, title: document.title || 'Current Page', favIconUrl: 'icon.png' }];
        }
    }

    showAddLinkModal(tabsList, sid);
}

function showAddLinkModal(tabsList, sessionId) {
    const session = state.sessions.find(s => s.id === sessionId);
    const sessionName = session ? session.name : 'Session';

    document.getElementById('modalTitle').innerText = `Add Links to "${sessionName}"`;
    document.getElementById('modalDesc').innerText = 'Select open tabs to add or paste custom URLs below:';
    
    document.getElementById('modalInput').style.display = 'none';
    const textarea = document.getElementById('modalTextarea');
    textarea.style.display = 'block';
    textarea.value = '';
    textarea.placeholder = 'Or paste custom URLs here (one per line)...';

    const customContent = document.getElementById('modalCustomContent');
    
    let tabRows = tabsList.map(t => {
        let domain = 'unknown';
        try { domain = new URL(t.url).hostname.replace(/^www\./, ''); } catch(e){}
        const fav = (domain && domain.includes('.')) ? `https://icons.duckduckgo.com/ip3/${domain}.ico` : (t.favIconUrl || DEFAULT_ICON);
        const titleText = t.title || domain || t.url;
        const isDupe = state.allLinks.some(l => l.url === t.url);
        
        return `
            <div class="add-tab-row ${isDupe ? 'is-dupe' : ''}" style="display:${isDupe ? 'none' : 'flex'}; align-items:center; gap:8px; padding:6px 8px; border-bottom:1px solid #27272a; background:#121215;">
                <input type="checkbox" class="add-tab-item-cb" data-url="${t.url}" data-tab-id="${t.id !== undefined && t.id !== null ? t.id : ''}" ${isDupe ? '' : 'checked'} style="accent-color:var(--accent); cursor:pointer;">
                <img src="${fav}" style="width:16px; height:16px; border-radius:4px; object-fit:contain;" onerror="this.onerror=null;this.src='${DEFAULT_ICON}'">
                <div style="flex-grow:1; overflow:hidden; text-align:left;">
                    <div style="font-size:0.78rem; font-weight:600; color:#f4f4f5; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${titleText}</div>
                    <div style="font-size:0.7rem; color:#a1a1aa; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${t.url}</div>
                </div>
            </div>
        `;
    }).join('');

    const tabsBoxHTML = `
        <div style="margin-top:8px; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center;">
            <div style="font-size:0.8rem; font-weight:600; color:#a1a1aa;">List of open tabs:</div>
            <div style="display:flex; align-items:center; gap: 10px;">
                <span id="dupMsgAdd" style="color:var(--warning); font-size:0.7rem; display:none;"></span>
                <label style="font-size:0.75rem; color:#a1a1aa; cursor:pointer; user-select:none; display:flex; align-items:center; gap:4px;">
                    <input type="checkbox" id="cbHideDupAdd" checked style="accent-color:var(--accent); margin:0;"> Hide Duplicates
                </label>
                <button id="btnClearDupAdd" class="mini-btn" style="background:transparent; border:1px solid #3f3f4e; color:#a1a1aa; padding: 2px 6px;">Clear Dupes</button>
                <label style="font-size:0.75rem; color:#8b5cf6; cursor:pointer; user-select:none; display:flex; align-items:center; gap:4px;">
                    <input type="checkbox" id="toggleAllAddTabs" checked style="accent-color:var(--accent); margin:0;"> Select All
                </label>
            </div>
        </div>
        <div style="max-height:160px; overflow-y:auto; border:1px solid #27272a; border-radius:8px; background:#09090b; margin-bottom:10px;">
            ${tabRows.length > 0 ? tabRows : '<div style="padding:12px; font-size:0.8rem; color:#71717a; text-align:center;">No open tabs found.</div>'}
        </div>
    `;
    
    customContent.innerHTML = tabsBoxHTML;
    customContent.style.display = 'block';

    const toggleAll = customContent.querySelector('#toggleAllAddTabs');
    if (toggleAll) {
        toggleAll.addEventListener('change', (e) => {
            customContent.querySelectorAll('.add-tab-item-cb').forEach(cb => {
                const row = cb.closest('.add-tab-row');
                if (row && row.style.display === 'none') return;
                cb.checked = e.target.checked;
            });
        });
    }

    const cbHideDup = customContent.querySelector('#cbHideDupAdd');
    if (cbHideDup) {
        cbHideDup.addEventListener('change', (e) => {
            const hide = e.target.checked;
            customContent.querySelectorAll('.add-tab-row.is-dupe').forEach(row => {
                row.style.display = hide ? 'none' : 'flex';
                if (hide) {
                    const cb = row.querySelector('.add-tab-item-cb');
                    if (cb) cb.checked = false;
                }
            });
        });
    }

    const btnClearDup = customContent.querySelector('#btnClearDupAdd');
    const dupMsg = customContent.querySelector('#dupMsgAdd');
    if (btnClearDup) {
        btnClearDup.addEventListener('click', (e) => {
            e.preventDefault();
            let unselectedCount = 0;
            customContent.querySelectorAll('.add-tab-item-cb').forEach(cb => {
                const url = cb.getAttribute('data-url');
                const isDupe = state.allLinks.some(l => l.url === url);
                if (isDupe && cb.checked) {
                    cb.checked = false;
                    unselectedCount++;
                }
            });
            dupMsg.innerText = `${unselectedCount} duplicate videos unselected`;
            dupMsg.style.display = 'inline';
            setTimeout(() => dupMsg.style.display = 'none', 3000);
        });
    }

    const confirmBtn = document.getElementById('modalConfirmBtn');
    confirmBtn.style.display = 'inline-block';
    confirmBtn.style.background = 'var(--accent)';
    confirmBtn.style.borderColor = 'var(--accent)';
    confirmBtn.innerText = 'Add Links';
    
    confirmBtn.onclick = () => {
        const checkedTabCbs = Array.from(customContent.querySelectorAll('.add-tab-item-cb:checked'));
        
        const selectedTabs = checkedTabCbs.map(cb => {
            const url = cb.getAttribute('data-url');
            const tabId = cb.getAttribute('data-tab-id');
            const tab = tabsList.find(t => (tabId && t.id == tabId) || t.url === url);
            return { url: url, title: tab ? tab.title : '' };
        });

        const selectedTabIds = checkedTabCbs
            .map(cb => cb.getAttribute('data-tab-id'))
            .filter(id => id && id !== 'undefined' && id !== 'null')
            .map(Number);

        const pastedText = textarea.value.trim();
        let allUrlsToAdd = [...selectedTabs];
        if (pastedText) {
            const pastedLines = pastedText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            pastedLines.forEach(url => allUrlsToAdd.push({ url }));
        }

        if (allUrlsToAdd.length === 0) {
            alert('Please select at least one tab or paste a link.');
            return;
        }

        addLinks(allUrlsToAdd, sessionId);
        closeModal();

        if (selectedTabIds.length > 0) {
            showCloseTabsPrompt(selectedTabIds, selectedTabIds.length);
        }
    };

    document.getElementById('customModal').style.display = 'flex';
}
function resetApp(){
    const activeProf = profilesData.profiles.find(p => p.id === profilesData.activeId);
    const profName = activeProf ? activeProf.name : 'Current Profile';
    showModal(`Reset ${profName}?`, `Are you sure you want to factory reset profile "${profName}"? This will clear all links and sessions in this profile.`, () => {
        state = { allLinks: [], sessions: [], groups: [] };
        createNewSession();
        saveState();
        renderAll();
    });
}

function showToast(message) {
    let toast = document.getElementById('appToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'appToast';
        toast.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%) translateY(100px);
            background: rgba(18, 18, 24, 0.95);
            color: #f4f4f5;
            border: 1px solid var(--accent);
            padding: 10px 20px;
            border-radius: 9999px;
            font-weight: 700;
            font-size: 0.85rem;
            box-shadow: 0 10px 30px rgba(139, 92, 246, 0.4);
            z-index: 99999;
            transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.35s ease;
            opacity: 0;
            pointer-events: none;
            display: flex;
            align-items: center;
            gap: 8px;
        `;
        document.body.appendChild(toast);
    }
    toast.innerHTML = `<span style="color:var(--accent); font-weight:800;">✓</span> ${message}`;
    toast.style.transform = 'translateX(-50%) translateY(0)';
    toast.style.opacity = '1';
    
    if (toast._timer) clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
        toast.style.transform = 'translateX(-50%) translateY(100px)';
        toast.style.opacity = '0';
    }, 2400);
}

function switchProfile(profileId) {
    if (!profileId || !profilesData || !Array.isArray(profilesData.profiles)) return;
    const targetProf = profilesData.profiles.find(p => p && String(p.id) === String(profileId));
    if (!targetProf) return;

    if (String(profilesData.activeId) === String(profileId)) {
        closeModal();
        closeSidebarDrawer();
        return;
    }

    // Save current profile state
    const currentProf = profilesData.profiles.find(p => p && String(p.id) === String(profilesData.activeId));
    if (currentProf) {
        currentProf.state = state;
    }

    // Set new active profile ID and state
    profilesData.activeId = String(profileId);
    state = targetProf.state || { allLinks: [], sessions: [], groups: [] };
    if (!state.allLinks) state.allLinks = [];
    if (!state.sessions) state.sessions = [];
    if (!state.groups) state.groups = [];

    saveState();
    renderAll();
    switchView('sessions');
    closeModal();
    closeSidebarDrawer();
}

function createNewProfile() {
    showInputModal('Create New Profile', 'Profile Name (e.g. Work, Personal)...', '', false, (name) => {
        if (name && name.trim()) {
            const newProfId = 'prof_' + Date.now();
            const profTitle = name.trim();

            const currentProf = profilesData.profiles.find(p => p && String(p.id) === String(profilesData.activeId));
            if (currentProf) {
                currentProf.state = state;
            }

            const newProf = {
                id: newProfId,
                name: profTitle,
                state: { allLinks: [], sessions: [{ id: Date.now(), name: 'Main Session', expanded: true, hidden: false, linkIds: [] }], groups: [] }
            };
            profilesData.profiles.push(newProf);
            profilesData.activeId = newProfId;
            state = newProf.state;

            saveState();
            renderAll();
            switchView('sessions');
            closeModal();
        }
    });
}

function renameProfile(profileId) {
    const prof = profilesData.profiles.find(p => p.id === profileId);
    if (!prof) return;
    showInputModal('Rename Profile', 'New Profile Name...', prof.name, false, (val) => {
        if (val && val.trim()) {
            prof.name = val.trim();
            saveProfilesData();
            updateProfileNavBtn();
            renderSidebarProfiles();
            const customContent = document.getElementById('modalCustomContent');
            if (customContent && customContent.style.display !== 'none' && customContent.innerHTML.includes('prof-card-row')) {
                showProfilesModal();
            }
            showToast(`Renamed profile to "${val.trim()}"`);
        }
    });
}

function deleteProfile(profileId) {
    const prof = profilesData.profiles.find(p => p.id === profileId);
    if (!prof) return;

    if (profilesData.profiles.length <= 1) {
        showModal('Cannot Delete Profile', 'You must have at least one profile. Create a new profile before deleting this one.', () => {}, false);
        return;
    }

    showModal(
        `Delete Profile "${prof.name}"?`,
        `Are you sure you want to permanently delete profile "${prof.name}"? This will delete all of its bookmarks, sessions, and groups!`,
        () => {
            profilesData.profiles = profilesData.profiles.filter(p => p.id !== profileId);
            if (profilesData.activeId === profileId) {
                profilesData.activeId = profilesData.profiles[0].id;
            }
            saveProfilesData();
            loadState();
            if (state.sessions.length === 0) createNewSession();
            renderAll();
            closeModal();
        }
    );
}

function showProfilesModal() {
    document.getElementById('modalTitle').innerText = 'Profiles Management';
    document.getElementById('modalDesc').innerText = 'Click a profile card to switch. Double-click profile name to rename:';
    
    document.getElementById('modalInput').style.display = 'none';
    document.getElementById('modalTextarea').style.display = 'none';
    
    const customContent = document.getElementById('modalCustomContent');
    
    let rowsHTML = profilesData.profiles.map(p => {
        const isActive = p.id === profilesData.activeId;
        const linkCount = p.state && p.state.allLinks ? p.state.allLinks.length : 0;
        const sessionCount = p.state && p.state.sessions ? p.state.sessions.length : 0;
        
        return `
            <div class="prof-card-row" data-id="${p.id}" style="display:flex; align-items:center; justify-content:space-between; padding:10px 14px; margin-bottom:8px; border:1px solid ${isActive ? 'rgba(139, 92, 246, 0.6)' : '#272730'}; border-radius:10px; background:${isActive ? 'linear-gradient(135deg, rgba(139, 92, 246, 0.12) 0%, rgba(18, 18, 22, 0.95) 100%)' : '#121215'}; cursor:pointer; user-select:none; transition: all 0.2s ease;" title="${isActive ? 'Active profile (Double-click name to rename)' : 'Click to switch profile (Double-click name to rename)'}">
                <div style="flex-grow:1; text-align:left; overflow:hidden; padding-right:10px;">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <svg style="width:15px; height:15px; color:${isActive ? 'var(--accent)' : '#a1a1aa'}; flex-shrink:0;" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path>
                        </svg>
                        <span class="prof-name-text" data-id="${p.id}" style="font-weight:700; font-size:0.88rem; color:#f4f4f5; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; transition:all 0.2s ease;" title="Double-click to rename">${p.name}</span>
                        ${isActive ? '<span style="background:linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%); color:#fff; padding:2px 7px; border-radius:9999px; font-size:0.62rem; font-weight:800; letter-spacing:0.04em; box-shadow:0 0 10px rgba(139,92,246,0.4);">ACTIVE</span>' : ''}
                    </div>
                    <div style="font-size:0.73rem; color:#a1a1aa; margin-top:3px; padding-left:23px;">
                        ${linkCount} link(s) • ${sessionCount} session(s)
                    </div>
                </div>
                <div style="display:flex; gap:6px; flex-shrink:0;">
                    ${profilesData.profiles.length > 1 ? `<button class="mini-btn btn-danger btn-del-prof" data-id="${p.id}" style="padding:4px 10px; font-size:0.75rem; border-radius:6px;">Del</button>` : ''}
                </div>
            </div>
        `;
    }).join('');

    const modalHTML = `
        <div style="max-height:230px; overflow-y:auto; margin-top:10px; margin-bottom:14px; padding-right:2px;">
            ${rowsHTML}
        </div>
        <button id="btnCreateProfModal" class="primary" style="width:100%; font-size:0.85rem; font-weight:700; padding:9px 0; border-radius:10px; background:linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%); box-shadow:0 4px 15px rgba(139, 92, 246, 0.35); border:1px solid rgba(255,255,255,0.2); cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px; transition:transform 0.15s ease;">
            <span>+</span> Create New Profile
        </button>
    `;
    
    customContent.innerHTML = modalHTML;
    customContent.style.display = 'block';

    // Click card row to switch profile
    customContent.querySelectorAll('.prof-card-row').forEach(row => {
        row.addEventListener('click', (e) => {
            if (e.target.closest('.btn-del-prof')) return;
            const id = row.getAttribute('data-id');
            switchProfile(id);
        });
    });

    // Double-click profile name to rename with pulse animation
    customContent.querySelectorAll('.prof-name-text').forEach(nameSpan => {
        nameSpan.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            nameSpan.classList.add('dblclick-animate');
            setTimeout(() => {
                const id = nameSpan.getAttribute('data-id');
                renameProfile(id);
            }, 180);
        });
    });

    // Delete profile button
    customContent.querySelectorAll('.btn-del-prof').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.getAttribute('data-id');
            deleteProfile(id);
        });
    });

    const createBtn = customContent.querySelector('#btnCreateProfModal');
    if (createBtn) {
        createBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            createNewProfile();
        });
    }

    const confirmBtn = document.getElementById('modalConfirmBtn');
    confirmBtn.style.display = 'none';

    const cancelBtn = document.getElementById('modalCancelBtn');
    if (cancelBtn) cancelBtn.innerText = 'Close';

    document.getElementById('customModal').style.display = 'flex';
}
