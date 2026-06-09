// ============================================================
// Trae Harvester — 测试面板 Webview 前端脚本
// ============================================================
// 在 Webview 沙箱中运行，处理步骤列表渲染和用户交互。

(function () {
    // @ts-ignore - acquireVsCodeApi 由 VS Code Webview 环境提供
    const vscode = acquireVsCodeApi();

    /** @type {Array<{step_number: number, title: string, command: string}>} */
    let steps = [];
    /** @type {Map<number, object>} */
    const results = new Map();

    // ---- DOM 引用 ----
    const emptyState = document.getElementById('empty-state');
    const stepsList = document.getElementById('steps-list');
    const summary = document.getElementById('summary');
    const summaryIcon = document.getElementById('summary-icon');
    const summaryText = document.getElementById('summary-text');
    
    // Tools
    const btnToggleMcp = document.getElementById('btn-toggle-mcp');
    const btnShowGlobalStatus = document.getElementById('btn-show-global-status');
    const btnCheckUpdates = document.getElementById('btn-check-updates');
    const btnOpenSettings = document.getElementById('btn-open-settings');
    const btnClearAll = document.getElementById('btn-clear-all');
    const btnExportPatch = document.getElementById('btn-export-patch');
    const btnExportLogs = document.getElementById('btn-export-logs');
    const btnExportResults = document.getElementById('btn-export-results');
    
    // Steps Actions
    const btnShowAddMenu = document.getElementById('btn-show-add-menu');
    const btnCopyJson = document.getElementById('btn-copy-json');
    const btnResetResults = document.getElementById('btn-reset-results');
    const btnRunAll = document.getElementById('btn-run-all');
    
    // Panels
    const panels = ['sub-menu-add', 'panel-add-step', 'panel-add-check'];
    const subMenuAdd = document.getElementById('sub-menu-add');
    const panelAddStep = document.getElementById('panel-add-step');
    const panelAddCheck = document.getElementById('panel-add-check');
    
    // Sub Menu actions
    const btnInput = document.getElementById('btn-input');
    const btnShowAddStep = document.getElementById('btn-show-add-step');
    const btnShowAddCheck = document.getElementById('btn-show-add-check');
    
    // Inputs & Add Buttons
    const inputStepTitle = document.getElementById('input-step-title');
    const inputStepCommand = document.getElementById('input-step-command');
    const btnAddStep = document.getElementById('btn-add-step');
    const inputCheckItem = document.getElementById('input-check-item');
    const btnAddCheck = document.getElementById('btn-add-check');

    // AI Context
    const inputAiContext = document.getElementById('input-ai-context');
    const btnSaveAiContext = document.getElementById('btn-save-ai-context');

    // Check Items
    const checkItemsSection = document.getElementById('check-items-section');
    const checkItemsList = document.getElementById('check-items-list');

    // Identifiers
    const selectRepo = document.getElementById('select-repo');
    const inputBranch = document.getElementById('input-branch');
    const selectModel = document.getElementById('select-model');
    const selectPrompt = document.getElementById('select-prompt');

    // ---- Panel 控制 ----
    function closeAllPanels() {
        panels.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
    }

    function openPanel(panelId) {
        closeAllPanels();
        const panel = document.getElementById(panelId);
        if (panel) {
            panel.style.display = 'block';
            const firstInput = panel.querySelector('input');
            if (firstInput) firstInput.focus();
        }
    }

    document.querySelectorAll('.panel-close').forEach(btn => {
        btn.addEventListener('click', closeAllPanels);
    });

    btnShowAddMenu.addEventListener('click', () => openPanel('sub-menu-add'));
    btnShowAddStep.addEventListener('click', () => openPanel('panel-add-step'));
    btnShowAddCheck.addEventListener('click', () => openPanel('panel-add-check'));
    btnInput.addEventListener('click', () => {
        closeAllPanels();
        vscode.postMessage({ command: 'inputSteps' });
    });

    // ---- Toast 与 Loading 反馈机制 ----
    function showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        if (!container) return;
        
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        let icon = 'ℹ️';
        if (type === 'success') icon = '✅';
        if (type === 'error') icon = '❌';

        toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
        container.appendChild(toast);
        
        void toast.offsetWidth; // 触发 reflow 激活动画
        toast.classList.add('show');

        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => {
                if (container.contains(toast)) container.removeChild(toast);
            }, 300);
        }, 3000);
    }

    // 模拟后端调用的 Loading 反馈 (因为后端不改，我们直接在前端用 setTimeout 给一点视觉反馈)
    function simulateActionWithToast(btnElement, commandStr, toastMsg, toastType, delayMs = 1000) {
        closeAllPanels();
        
        // 发送给后端执行
        if (commandStr) {
            vscode.postMessage({ command: commandStr });
        }
        
        if (!btnElement) return;

        // 设置 Loading 态
        const btnTextEl = btnElement.querySelector('.btn-text');
        const originalText = btnTextEl ? btnTextEl.innerText : btnElement.innerText;
        btnElement.classList.add('loading');
        btnElement.disabled = true;
        if (btnTextEl) btnTextEl.innerText = '执行中...';

        // 假装等待后端执行完毕
        setTimeout(() => {
            btnElement.classList.remove('loading');
            btnElement.disabled = false;
            if (btnTextEl) btnTextEl.innerText = originalText;

            if (toastMsg) {
                showToast(toastMsg, toastType);
            }
        }, delayMs);
    }

    // ---- 绑定按钮动作 ----
    const btnGitFetch = document.getElementById('btn-git-fetch');
    if (btnGitFetch) {
        btnGitFetch.addEventListener('click', () => {
            simulateActionWithToast(btnGitFetch, 'gitFetch', 'Git Fetch 执行中...', 'info', 2000);
        });
    }

    if (btnToggleMcp) {
        btnToggleMcp.addEventListener('click', () => {
            // MCP 的状态是自动推给前端的，这里不需要假 loading
            vscode.postMessage({ command: 'toggleMcp' });
        });
    }

    if (btnShowGlobalStatus) {
        btnShowGlobalStatus.addEventListener('click', () => {
            vscode.postMessage({ command: 'showGlobalStatus' });
        });
    }

    if (btnCheckUpdates) {
        btnCheckUpdates.addEventListener('click', () => {
            // 检查更新可能耗时较长，前端假装 loading 1.5 秒
            simulateActionWithToast(btnCheckUpdates, 'checkUpdates', '', 'info', 1500);
        });
    }

    if (btnOpenSettings) {
        btnOpenSettings.addEventListener('click', () => {
            vscode.postMessage({ command: 'openSettings' });
        });
    }

    if (btnClearAll) {
        btnClearAll.addEventListener('click', () => {
            simulateActionWithToast(btnClearAll, 'clearAll', '所有数据已清除', 'error', 500);
        });
    }

    if (btnExportPatch) {
        btnExportPatch.addEventListener('click', () => {
            simulateActionWithToast(btnExportPatch, 'exportPatch', 'Patch 导出请求已发送', 'success', 800);
        });
    }

    if (btnExportLogs) {
        btnExportLogs.addEventListener('click', () => {
            simulateActionWithToast(btnExportLogs, 'exportLogs', '调试日志导出请求已发送', 'info', 800);
        });
    }

    if (btnExportResults) {
        btnExportResults.addEventListener('click', () => {
            simulateActionWithToast(btnExportResults, 'exportResults', '测试报告生成请求已发送', 'success', 800);
        });
    }

    if (btnCopyJson) {
        btnCopyJson.addEventListener('click', () => {
            simulateActionWithToast(btnCopyJson, 'copyJson', 'JSON 已复制到剪贴板', 'success', 500);
        });
    }

    if (btnResetResults) {
        btnResetResults.addEventListener('click', () => {
            simulateActionWithToast(btnResetResults, 'resetResults', '测试状态已被重置', 'info', 500);
        });
    }

    if (btnRunAll) {
        btnRunAll.addEventListener('click', () => {
            vscode.postMessage({ command: 'runAll' });
        });
    }

    if (btnSaveAiContext) {
        btnSaveAiContext.addEventListener('click', () => {
            const text = inputAiContext.value.trim();
            if (!text) {
                showToast('请输入 AI 上下文内容', 'error');
                return;
            }
            simulateActionWithToast(btnSaveAiContext, null, 'AI 上下文已保存', 'success', 500);
            vscode.postMessage({ command: 'saveAiContext', text });
        });
    }

    // ---- 提交添加的逻辑 (支持回车) ----
    function submitStep() {
        const title = inputStepTitle.value.trim();
        const commandToRun = inputStepCommand.value.trim();
        if (title && commandToRun) {
            vscode.postMessage({ command: 'addStep', title, commandToRun });
            showToast(`成功添加指令: ${title}`, 'success');
            inputStepTitle.value = '';
            inputStepCommand.value = '';
            closeAllPanels();
        }
    }

    function submitCheck() {
        const item = inputCheckItem.value.trim();
        if (item) {
            vscode.postMessage({ command: 'addCheckItem', item });
            showToast(`成功添加检查项: ${item}`, 'success');
            inputCheckItem.value = '';
            closeAllPanels();
        }
    }

    if (btnAddStep) btnAddStep.addEventListener('click', submitStep);
    if (btnAddCheck) btnAddCheck.addEventListener('click', submitCheck);

    if (inputStepTitle) {
        inputStepTitle.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') inputStepCommand.focus();
        });
    }
    if (inputStepCommand) {
        inputStepCommand.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') submitStep();
        });
    }
    if (inputCheckItem) {
        inputCheckItem.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') submitCheck();
        });
    }

    // ---- 标识符变更通知 ----
    function notifyIdentifiersChange() {
        if (!selectRepo || !selectModel || !selectPrompt) return;
        vscode.postMessage({
            command: 'updateIdentifiers',
            repoId: selectRepo.value,
            branch: inputBranch ? inputBranch.value : '',
            modelId: selectModel.value,
            promptId: selectPrompt.value
        });
    }

    if (selectRepo) {
        selectRepo.addEventListener('change', notifyIdentifiersChange);
    }
    if (selectModel) {
        selectModel.addEventListener('change', notifyIdentifiersChange);
    }
    if (selectPrompt) {
        selectPrompt.addEventListener('change', notifyIdentifiersChange);
    }

    // ---- 消息总线 (接收后端回传) ----
    window.addEventListener('message', event => {
        const message = event.data;
        switch (message.command) {
            case 'loadSteps':
                steps = message.steps || [];

                // Render Repo Options
                if (selectRepo && message.repoOptions) {
                    selectRepo.innerHTML = '';
                    message.repoOptions.forEach(opt => {
                        const option = document.createElement('option');
                        option.value = opt;
                        option.textContent = opt;
                        selectRepo.appendChild(option);
                    });
                    if (message.repoId) {
                        selectRepo.value = message.repoId;
                    } else if (message.repoOptions.length > 0) {
                        selectRepo.value = message.repoOptions[0];
                    }
                }

                // Set Branch (readonly)
                if (inputBranch) {
                    inputBranch.value = message.branch || 'unknown';
                }

                // Render Model Options
                if (selectModel && message.modelOptions) {
                    selectModel.innerHTML = '';
                    message.modelOptions.forEach(opt => {
                        const option = document.createElement('option');
                        option.value = opt;
                        option.textContent = opt;
                        selectModel.appendChild(option);
                    });
                    if (message.modelId) {
                        selectModel.value = message.modelId;
                    } else if (message.modelOptions.length > 0) {
                        selectModel.value = message.modelOptions[0];
                        notifyIdentifiersChange();
                    }
                }
                
                if (selectPrompt && message.promptOptions) {
                    selectPrompt.innerHTML = '';
                    message.promptOptions.forEach(opt => {
                        const option = document.createElement('option');
                        option.value = opt;
                        option.textContent = opt;
                        selectPrompt.appendChild(option);
                    });
                    if (message.promptId) {
                        selectPrompt.value = message.promptId;
                    } else if (message.promptOptions.length > 0) {
                        selectPrompt.value = message.promptOptions[0];
                        notifyIdentifiersChange();
                    }
                }

                // 如果是从后端重新加载（如点击重置后），清空前端状态缓存
                results.clear();
                renderSteps();
                renderCheckItems(message.checkItems || []);
                updateSummary();
                
                if (btnToggleMcp) {
                    const mcpTextEl = btnToggleMcp.querySelector('.btn-text');
                    const mcpIconEl = btnToggleMcp.querySelector('.icon-normal');
                    if (message.isMcpRunning) {
                        mcpIconEl.innerText = '🟢';
                        mcpTextEl.innerText = '关闭 MCP';
                    } else {
                        mcpIconEl.innerText = '🔴';
                        mcpTextEl.innerText = '启动 MCP';
                    }
                }
                break;
            case 'stepStarted':
            case 'stepCompleted':
                if (message.result) {
                    results.set(message.result.step_number, message.result);
                }
                updateStepUI(message.stepNumber, message.command === 'stepStarted');
                updateSummary();
                break;
            case 'allCompleted':
                const res = message.result;
                summary.style.display = 'flex';
                if (res.final_status === 'PASS') {
                    summary.className = 'summary pass';
                    summaryIcon.textContent = '✅';
                    summaryText.textContent = `全部完成 (${res.passed_steps}/${res.total_steps} 通过)`;
                    showToast('🎉 所有测试执行完毕', 'success');
                } else if (res.final_status === 'FAIL') {
                    summary.className = 'summary fail';
                    summaryIcon.textContent = '❌';
                    summaryText.textContent = `全部失败 (${res.failed_steps}/${res.total_steps})`;
                    showToast('💥 所有测试执行失败', 'error');
                } else {
                    summary.className = 'summary fail';
                    summaryIcon.textContent = '⚠️';
                    summaryText.textContent = `部分完成 (通过: ${res.passed_steps}, 失败: ${res.failed_steps}, 跳过: ${res.skipped_steps})`;
                    showToast('⚠️ 测试执行完毕 (部分失败)', 'error');
                }
                btnRunAll.disabled = false;
                
                const originalText = btnRunAll.querySelector('.btn-text').innerText;
                btnRunAll.classList.remove('loading');
                btnRunAll.querySelector('.btn-text').innerText = '全部执行';
                break;
        }
    });

    // ---- UI 渲染逻辑 ----
    function renderSteps() {
        if (steps.length === 0) {
            emptyState.style.display = 'block';
            stepsList.style.display = 'none';
            btnRunAll.disabled = true;
            summary.style.display = 'none';
            return;
        }

        emptyState.style.display = 'none';
        stepsList.style.display = 'flex';
        btnRunAll.disabled = false;
        stepsList.innerHTML = '';

        steps.forEach((step, index) => {
            const stepEl = document.createElement('div');
            stepEl.className = 'step-item';
            stepEl.id = `step-${step.step_number}`;

            // Create step index
            const indexEl = document.createElement('div');
            indexEl.className = 'step-index';
            indexEl.textContent = step.step_number;
            
            // Create step content
            const contentEl = document.createElement('div');
            contentEl.className = 'step-content';
            
            const titleEl = document.createElement('div');
            titleEl.className = 'step-title';
            titleEl.textContent = step.title;
            titleEl.title = step.title;
            
            const cmdEl = document.createElement('div');
            cmdEl.className = 'step-command';
            cmdEl.textContent = step.command;
            cmdEl.title = step.command;
            
            contentEl.appendChild(titleEl);
            contentEl.appendChild(cmdEl);
            
            // Create status badge
            const statusEl = document.createElement('div');
            statusEl.className = 'step-status';
            statusEl.id = `status-${step.step_number}`;
            statusEl.textContent = 'WAIT';
            
            // Create actions
            const actionsEl = document.createElement('div');
            actionsEl.style.display = 'flex';
            actionsEl.style.gap = '4px';
            
            const playBtn = document.createElement('button');
            playBtn.className = 'btn btn-secondary btn-small';
            playBtn.innerHTML = '▶';
            playBtn.title = '执行此步骤';
            playBtn.onclick = () => {
                playBtn.innerHTML = '<span class="spinner" style="display:block;width:10px;height:10px;"></span>';
                vscode.postMessage({ command: 'runStep', stepNumber: step.step_number });
            };
            
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn btn-secondary btn-small';
            deleteBtn.innerHTML = '×';
            deleteBtn.title = '删除此步骤';
            deleteBtn.style.color = 'var(--vscode-errorForeground)';
            deleteBtn.onclick = () => {
                vscode.postMessage({ command: 'deleteStep', stepNumber: step.step_number });
            };
            
            actionsEl.appendChild(playBtn);
            actionsEl.appendChild(deleteBtn);

            stepEl.appendChild(indexEl);
            stepEl.appendChild(contentEl);
            stepEl.appendChild(statusEl);
            stepEl.appendChild(actionsEl);

            stepsList.appendChild(stepEl);
        });

        updateSummary();
    }

    function renderCheckItems(items) {
        if (items.length === 0) {
            checkItemsSection.style.display = 'none';
            return;
        }

        checkItemsSection.style.display = 'block';
        checkItemsList.innerHTML = '';

        items.forEach((item, index) => {
            const div = document.createElement('div');
            div.className = 'check-item';
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = `check-${index}`;
            checkbox.checked = item.passed;
            checkbox.onchange = (e) => {
                vscode.postMessage({ command: 'toggleCheckItem', index: index, passed: e.target.checked });
            };
            
            const label = document.createElement('label');
            label.htmlFor = `check-${index}`;
            label.textContent = item.text || item.item; // Fallback to item if someone used wrong key
            
            const deleteBtn = document.createElement('span');
            deleteBtn.innerHTML = '×';
            deleteBtn.style.cursor = 'pointer';
            deleteBtn.style.color = 'var(--vscode-errorForeground)';
            deleteBtn.style.marginLeft = 'auto';
            deleteBtn.title = '删除此检查项';
            deleteBtn.onclick = () => {
                vscode.postMessage({ command: 'removeCheckItem', index: index });
            };
            
            div.appendChild(checkbox);
            div.appendChild(label);
            div.appendChild(deleteBtn);
            checkItemsList.appendChild(div);
        });
    }

    function updateStepUI(stepNumber, isRunning = false) {
        const stepEl = document.getElementById(`step-${stepNumber}`);
        const statusEl = document.getElementById(`status-${stepNumber}`);
        if (!stepEl || !statusEl) return;

        // Reset classes
        stepEl.className = 'step-item';
        statusEl.className = 'step-status';

        if (isRunning) {
            stepEl.classList.add('running');
            statusEl.textContent = 'RUNNING';
            return;
        }

        const result = results.get(stepNumber);
        if (result) {
            statusEl.textContent = result.status;
            
            // 恢复 playBtn 状态
            const playBtn = stepEl.querySelector('.btn-small');
            if (playBtn) {
                playBtn.innerHTML = '▶';
            }
            
            if (result.status === 'PASS') {
                stepEl.classList.add('pass');
                statusEl.classList.add('pass');
            } else if (['FAIL', 'ERROR', 'TIMEOUT'].includes(result.status)) {
                stepEl.classList.add('fail');
                statusEl.classList.add('fail');
            } else if (result.status === 'SKIP') {
                stepEl.classList.add('skip');
                statusEl.classList.add('skip');
            }
        }
    }

    function updateSummary() {
        if (steps.length === 0) return;
        
        let passed = 0;
        let failed = 0;
        let pending = 0;
        
        steps.forEach(step => {
            const result = results.get(step.step_number);
            if (!result || result.status === 'PENDING') {
                pending++;
            } else if (result.status === 'PASS') {
                passed++;
            } else if (['FAIL', 'ERROR', 'TIMEOUT'].includes(result.status)) {
                failed++;
            }
        });

        if (pending === steps.length) {
            summary.style.display = 'none';
            return;
        }

        if (pending > 0 && passed === 0 && failed === 0) {
            summary.style.display = 'none';
            return;
        }

        summary.style.display = 'flex';
        
        if (pending > 0) {
            summary.className = 'summary';
            summaryIcon.textContent = '⏳';
            summaryText.textContent = `执行中... (已完成: ${passed + failed}/${steps.length})`;
        } else {
            // Summary logic mostly handled by 'allCompleted' now
        }
    }

    // 触发 initial load
    vscode.postMessage({ command: 'ready' });
})();
