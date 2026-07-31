const DEFAULT_ICON = "icon.png";
let state = { allLinks: [], sessions: [], groups: [] };

document.addEventListener('DOMContentLoaded', () => {
    // Nav items
    document.querySelectorAll('.nav-item').forEach((el, index) => {
        el.addEventListener('click', () => {
            const views = ['home', 'sessions', 'groups', 'export'];
            if (index < views.length) switchView(views[index]);
            else if (el.textContent.includes('Cleanup')) removeDuplicates();
            else if (el.textContent.includes('Reset')) resetApp();
        });
    });

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

    const btnCancelModal = document.getElementById('modalCancelBtn');
    if(btnCancelModal) btnCancelModal.addEventListener('click', closeModal);

    // Save All Tabs specific
    document.getElementById('btnSaveTabs').addEventListener('click', async () => {
        let tabsList = [];
        if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
            const tabs = await chrome.tabs.query({ currentWindow: true });
            tabsList = tabs.filter(t => t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('edge://') && !t.url.startsWith('about:'));
        }
            
        if (tabsList.length === 0) {
            const dummyUrl = window.location.href;
            tabsList = [{ id: null, url: dummyUrl, title: document.title || 'Current Page', favIconUrl: 'icon.png' }];
        }
        
        showSaveTabsModal(tabsList);
    });

    loadState(); 
    if(state.sessions.length===0) createNewSession(); 
    renderAll();
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
        case 'closeContainerLinks': e.stopPropagation(); closeContainerLinks(ids); break;
        case 'openContainerLinks': e.stopPropagation(); openContainerLinks(ids); break;
        case 'renameSession': e.stopPropagation(); editSessionName(id, actionEl.closest('.accordion-header')); break;
        case 'deleteSession': e.stopPropagation(); confirmDeleteSession(id); break;
        case 'deleteGroup': e.stopPropagation(); confirmDeleteGroup(id); break;
        case 'promptAdd': e.stopPropagation(); promptAdd(id); break;
        case 'updateMergeUI': e.stopPropagation(); updateMergeUI(); break;
        case 'deleteSessionLink': e.stopPropagation(); confirmDeleteSessionLink(parseFloat(actionEl.getAttribute('data-session-id')), id); break;
        case 'cardClick':
            if(e.target.tagName==='BUTTON'||e.target.closest('button'))return;
            e.preventDefault();
            chrome.tabs.create({ url: url, active: false });
            break;
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
    const saved = localStorage.getItem('linkMasterV6');
    if(saved) { state = JSON.parse(saved); state.sessions.forEach(s => {if(s.hidden===undefined)s.hidden=false;}); }
}
function saveState() { localStorage.setItem('linkMasterV6', JSON.stringify(state)); }

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

function addLinks(text, sessionId = null) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) return;

    let addedIds = [];
    lines.forEach(rawUrl => {
        let cleanUrl = rawUrl;
        if (!cleanUrl.match(/^https?:\/\//i)) cleanUrl = 'https://' + cleanUrl;
        
        let domain = 'unknown';
        try { domain = new URL(cleanUrl).hostname.replace(/^www\./, ''); } catch (e) {}

        const newLink = {
            id: Date.now() + Math.random(),
            url: cleanUrl,
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
        
        return `
            <div style="display:flex; align-items:center; gap:8px; padding:6px 8px; border-bottom:1px solid #27272a; background:#121215;">
                <input type="checkbox" class="save-tab-item-cb" data-tab-id="${t.id || ''}" data-url="${t.url}" checked style="accent-color:var(--accent); cursor:pointer;">
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
            <label style="font-size:0.75rem; color:#8b5cf6; cursor:pointer; user-select:none;">
                <input type="checkbox" id="toggleAllSaveTabs" checked style="accent-color:var(--accent); vertical-align:middle; margin-right:4px;"> Select All
            </label>
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
                cb.checked = e.target.checked;
            });
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

        const selectedTabUrls = Array.from(checkedItemCbs).map(cb => cb.getAttribute('data-url'));
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
        
        const urlsText = selectedTabUrls.join('\n');
        addLinks(urlsText, targetSessionId);
        closeModal();
        switchView('sessions');
        renderSessions();

        showCloseTabsPrompt(selectedTabIds, selectedTabUrls.length);
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
        chrome.tabs.query({ currentWindow: true }, (tabs) => {
            const tabsToClose = tabs.filter(t => t.url && urls.some(u => isUrlMatch(t.url, u)));
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

function isUrlMatch(url1, url2) {
    if (!url1 || !url2) return false;
    if (url1 === url2) return true;
    try {
        const u1 = new URL(url1);
        const u2 = new URL(url2);
        return u1.origin + u1.pathname === u2.origin + u2.pathname;
    } catch(e) {
        return url1.includes(url2) || url2.includes(url1);
    }
}

function renderAll() { renderHome(); renderSessions(); renderGroups(); renderExport(); }

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
            <a href="${l.url}" target="_blank" class="stack-link" data-action="toggleWatch" data-id="${l.id}">${l.url}</a>
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
        const active = links.filter(l=>!l.watched).length;
        const div = document.createElement('div');
        div.className = `accordion-item ${s.expanded?'expanded':''} ${s.hidden?'is-hidden':''}`;
        div.setAttribute('data-drop-zone', 'true');
        div.setAttribute('data-session-id', s.id);
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
                    <button class="mini-btn btn-danger" data-action="closeContainerLinks" data-ids="${s.linkIds.join(',')}">Close</button>
                    <button class="mini-btn btn-open-all" data-action="openContainerLinks" data-ids="${s.linkIds.join(',')}">Open</button>
                    <button class="mini-btn" data-action="renameSession" data-id="${s.id}">Edit</button>
                    <button class="mini-btn btn-danger" data-action="deleteSession" data-id="${s.id}">Del</button>
                </div>
            </div>
            <div class="accordion-content"><div class="accordion-inner-padding"><div class="cards-grid" data-drop-zone="true" data-session-id="${s.id}">
                <div class="link-card" style="border-style:dashed; border-color:#333; justify-content:center; opacity:0.6; cursor:pointer;" data-action="promptAdd" data-id="${s.id}"><div>+ Add Link</div></div>
                ${links.map(l=>createCardHTML(l, s.id)).join('')}
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
    return `
        <div class="link-card ${l.watched?'watched':''}" data-action="cardClick" data-url="${l.url}" ${sessionId ? `draggable="true" data-action-dragstart="handleDragStart" data-session-id="${sessionId}" data-link-id="${l.id}"` : ''}>
            <div class="card-icon"><img src="${fav}" onerror="this.onerror=null;this.src='${DEFAULT_ICON}'"></div>
            <div class="card-info"><div class="card-title">${l.domain.toUpperCase()}</div><div class="card-desc">${l.url}</div></div>
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
function promptAdd(sid){ const u=prompt("URL:"); if(u) addLinks(u,sid); }
function resetApp(){ if(confirm("Factory Reset?")){ state={allLinks:[],sessions:[],groups:[]}; createNewSession(); location.reload(); } }
