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
    const btnInput = document.getElementById('btn-input'); // this is in sub-menu now
    const btnRunAll = document.getElementById('btn-run-all');
    const btnExportPatch = document.getElementById('btn-export-patch');
    const btnExportLogs = document.getElementById('btn-export-logs');
    const btnExportResults = document.getElementById('btn-export-results');
    const btnCopyJson = document.getElementById('btn-copy-json');
    const btnToggleMcp = document.getElementById('btn-toggle-mcp');
    const btnOpenSettings = document.getElementById('btn-open-settings');
    const inputAiContext = document.getElementById('input-ai-context');
    const btnSaveAiContext = document.getElementById('btn-save-ai-context');
    const btnClearAll = document.getElementById('btn-clear-all');
    const btnResetResults = document.getElementById('btn-reset-results');

    // ---- 新增：主菜单按钮及面板 ----
    const btnShowAddMenu = document.getElementById('btn-show-add-menu');
    const subMenuAdd = document.getElementById('sub-menu-add');
    const btnCloseSubMenu = document.getElementById('btn-close-sub-menu');
    const btnShowAddStep = document.getElementById('btn-show-add-step');
    const btnShowAddCheck = document.getElementById('btn-show-add-check');

    const panelAddStep = document.getElementById('panel-add-step');
    const btnCloseAddStep = document.getElementById('btn-close-add-step');
    const inputStepTitle = document.getElementById('input-step-title');
    const inputStepCommand = document.getElementById('input-step-command');
    const btnAddStep = document.getElementById('btn-add-step');

    const panelAddCheck = document.getElementById('panel-add-check');
    const btnCloseAddCheck = document.getElementById('btn-close-add-check');
    const checkItemsSection = document.getElementById('check-items-section');
    const checkItemsList = document.getElementById('check-items-list');
    const inputCheckItem = document.getElementById('input-check-item');
    const btnAddCheck = document.getElementById('btn-add-check');

    // ---- 隐藏所有面板 ----
    function hideAllPanels() {
        subMenuAdd.style.display = 'none';
        panelAddStep.style.display = 'none';
        panelAddCheck.style.display = 'none';
    }

    // ---- 按钮事件 ----
    btnShowAddMenu.addEventListener('click', () => {
        hideAllPanels();
        subMenuAdd.style.display = 'block';
    });
    btnCloseSubMenu.addEventListener('click', hideAllPanels);

    btnShowAddStep.addEventListener('click', () => {
        hideAllPanels();
        panelAddStep.style.display = 'block';
    });
    btnCloseAddStep.addEventListener('click', hideAllPanels);

    btnShowAddCheck.addEventListener('click', () => {
        hideAllPanels();
        panelAddCheck.style.display = 'block';
    });
    btnCloseAddCheck.addEventListener('click', hideAllPanels);

    btnInput.addEventListener('click', () => {
        hideAllPanels();
        vscode.postMessage({ command: 'inputSteps' });
    });

    btnExportPatch.addEventListener('click', () => {
        vscode.postMessage({ command: 'exportPatch' });
    });

    btnExportLogs.addEventListener('click', () => {
        vscode.postMessage({ command: 'exportLogs' });
    });

    btnExportResults.addEventListener('click', () => {
        vscode.postMessage({ command: 'exportResults' });
    });

    btnCopyJson.addEventListener('click', () => {
        vscode.postMessage({ command: 'copyJson' });
    });

    btnToggleMcp.addEventListener('click', () => {
        vscode.postMessage({ command: 'toggleMcp' });
    });

    btnOpenSettings.addEventListener('click', () => {
        vscode.postMessage({ command: 'openSettings' });
    });

    btnSaveAiContext.addEventListener('click', () => {
        const text = inputAiContext.value.trim();
        vscode.postMessage({ command: 'saveAiContext', text });
    });

    if (btnClearAll) {
        btnClearAll.addEventListener('click', () => {
            vscode.postMessage({ command: 'clearAll' });
        });
    }

    if (btnResetResults) {
        btnResetResults.addEventListener('click', () => {
            vscode.postMessage({ command: 'resetResults' });
        });
    }

    btnAddStep.addEventListener('click', () => {
        const title = inputStepTitle.value.trim();
        const commandToRun = inputStepCommand.value.trim();
        if (title && commandToRun) {
            vscode.postMessage({ command: 'addStep', title, commandToRun });
            inputStepTitle.value = '';
            inputStepCommand.value = '';
        }
    });

    btnAddCheck.addEventListener('click', () => {
        const item = inputCheckItem.value.trim();
        if (item) {
            vscode.postMessage({ command: 'addCheckItem', item });
            inputCheckItem.value = '';
        }
    });

    // ---- 支持回车键提交 ----
    inputStepTitle.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            inputStepCommand.focus();
        }
    });

    inputStepCommand.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            btnAddStep.click();
        }
    });

    inputCheckItem.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            btnAddCheck.click();
        }
    });

    // ---- 点击外部关闭面板 ----
    document.addEventListener('click', (e) => {
        // 如果点击的不是展示按钮，也不是面板内部，就关闭面板
        const isClickOnShowBtn = e.target.closest('#btn-show-add-menu') || 
                                 e.target.closest('#btn-show-add-step') || 
                                 e.target.closest('#btn-show-add-check');
        const isClickInsidePanel = e.target.closest('.sub-menu-panel') || 
                                   e.target.closest('.input-panel');
        
        if (!isClickOnShowBtn && !isClickInsidePanel) {
            hideAllPanels();
        }
    });

    btnRunAll.addEventListener('click', () => {
        vscode.postMessage({ command: 'runAll' });
    });

    // ---- 接收 Extension 消息 ----
    window.addEventListener('message', (event) => {
        const message = event.data;

        switch (message.command) {
            case 'loadSteps':
                if (message.isMcpRunning !== undefined) {
                    if (message.isMcpRunning) {
                        btnToggleMcp.textContent = '🟢 关闭 MCP';
                        btnToggleMcp.title = '关闭 MCP Server';
                    } else {
                        btnToggleMcp.textContent = '🔴 启动 MCP';
                        btnToggleMcp.title = '开启 MCP Server 供大模型连接';
                    }
                }

                if (message.aiContext !== undefined) {
                    inputAiContext.value = message.aiContext;
                }

                steps = message.steps || [];
                results.clear();
                renderSteps(steps);
                renderCheckItems(message.checkItems || []);
                break;

            case 'stepStarted':
                markStepRunning(message.stepNumber);
                break;

            case 'stepCompleted':
                results.set(message.stepNumber, message.result);
                updateStepResult(message.stepNumber, message.result);
                break;

            case 'allCompleted':
                updateSummary(message.result);
                break;

            case 'error':
                showError(message.message);
                break;
        }
    });

    // ---- 渲染函数 ----

    /**
     * 渲染步骤列表
     */
    function renderSteps(steps) {
        stepsList.innerHTML = '';
        
        if (steps.length === 0) {
            emptyState.style.display = 'block';
            stepsList.style.display = 'none';
            summary.style.display = 'none';
            btnRunAll.disabled = true;
            return;
        }

        emptyState.style.display = 'none';
        stepsList.style.display = 'flex';
        summary.style.display = 'block';
        btnRunAll.disabled = false;

        for (const step of steps) {
            const item = document.createElement('div');
            item.className = 'step-item';
            item.id = `step-${step.step_number}`;

            item.innerHTML = `
                <span class="step-icon" id="icon-${step.step_number}">⬜</span>
                <div class="step-content">
                    <div class="step-title">
                        <span>#${step.step_number} ${escapeHtml(step.title)}</span>
                        <div class="step-actions">
                            <button class="btn-icon play" title="独立执行" data-action="run" data-step="${step.step_number}">▶</button>
                            <button class="btn-icon delete" title="删除步骤" data-action="delete" data-step="${step.step_number}">🗑️</button>
                        </div>
                    </div>
                    <div class="step-command">${escapeHtml(step.command)}</div>
                    <div class="step-meta" id="meta-${step.step_number}"></div>
                </div>
            `;

            // 绑定事件
            const btnRun = item.querySelector('[data-action="run"]');
            const btnDelete = item.querySelector('[data-action="delete"]');
            
            btnRun.addEventListener('click', () => {
                vscode.postMessage({ command: 'runStep', stepNumber: step.step_number });
            });
            
            btnDelete.addEventListener('click', () => {
                vscode.postMessage({ command: 'deleteStep', stepNumber: step.step_number });
            });

            stepsList.appendChild(item);
        }

        // 重置汇总
        summaryIcon.textContent = '📊';
        summaryText.textContent = `共 ${steps.length} 个步骤，等待执行...`;
    }

    /**
     * 标记步骤为正在执行
     */
    function markStepRunning(stepNumber) {
        const item = document.getElementById(`step-${stepNumber}`);
        const icon = document.getElementById(`icon-${stepNumber}`);
        const meta = document.getElementById(`meta-${stepNumber}`);

        if (item) {
            item.className = 'step-item running';
        }
        if (icon) {
            icon.textContent = '⏳';
        }
        if (meta) {
            meta.textContent = '执行中...';
        }
    }

    /**
     * 更新步骤执行结果
     */
    function updateStepResult(stepNumber, result) {
        const item = document.getElementById(`step-${stepNumber}`);
        const icon = document.getElementById(`icon-${stepNumber}`);
        const meta = document.getElementById(`meta-${stepNumber}`);

        if (!item || !icon || !meta) {
            return;
        }

        // 更新状态样式
        const statusMap = {
            'PASS': { icon: '✅', className: 'step-item pass' },
            'FAIL': { icon: '❌', className: 'step-item fail' },
            'ERROR': { icon: '💥', className: 'step-item fail' },
            'TIMEOUT': { icon: '⏰', className: 'step-item fail' },
            'SKIP': { icon: '⏭', className: 'step-item skip' },
            'PENDING': { icon: '⬜', className: 'step-item' },
        };

        const status = statusMap[result.status] || statusMap['PENDING'];
        item.className = status.className;
        icon.textContent = status.icon;

        // 显示元信息
        const parts = [];
        if (result.exit_code !== null && result.exit_code !== undefined) {
            parts.push(`exit=${result.exit_code}`);
        }
        if (result.duration_ms > 0) {
            parts.push(formatDuration(result.duration_ms));
        }
        if (result.error_message) {
            parts.push(result.error_message);
        }
        meta.textContent = parts.join(' | ');
    }

    /**
     * 更新汇总信息
     */
    function updateSummary(testResult) {
        if (!testResult) {
            return;
        }

        const iconMap = {
            'PASS': '✅',
            'FAIL': '❌',
            'PARTIAL': '⚠️',
        };

        summaryIcon.textContent = iconMap[testResult.final_status] || '📊';
        summaryText.textContent = [
            `${testResult.final_status}`,
            `通过: ${testResult.passed_steps}/${testResult.total_steps}`,
            testResult.failed_steps > 0 ? `失败: ${testResult.failed_steps}` : '',
            testResult.skipped_steps > 0 ? `跳过: ${testResult.skipped_steps}` : '',
        ].filter(Boolean).join(' | ');
    }

    /**
     * 显示错误信息
     */
    function showError(message) {
        summaryIcon.textContent = '❌';
        summaryText.textContent = `错误: ${message}`;
        summary.style.display = 'block';
    }

    // ---- 工具函数 ----

    function renderCheckItems(items) {
        checkItemsList.innerHTML = '';
        if (items.length === 0) {
            checkItemsSection.style.display = 'none';
            return;
        }
        
        checkItemsSection.style.display = 'block';

        items.forEach((itemObj, index) => {
            const div = document.createElement('div');
            div.className = 'check-item';
            
            // itemObj 是 { text: string, passed: boolean }
            div.innerHTML = `
                <div class="check-item-left">
                    <input type="checkbox" class="check-item-checkbox" data-index="${index}" ${itemObj.passed ? 'checked' : ''} />
                    <span>${escapeHtml(itemObj.text)}</span>
                </div>
                <button class="btn-icon delete" title="删除" data-index="${index}">🗑️</button>
            `;

            const btnDelete = div.querySelector('button.delete');
            btnDelete.addEventListener('click', () => {
                vscode.postMessage({ command: 'removeCheckItem', index });
            });

            const checkbox = div.querySelector('.check-item-checkbox');
            checkbox.addEventListener('change', (e) => {
                vscode.postMessage({ command: 'toggleCheckItem', index, passed: e.target.checked });
            });

            checkItemsList.appendChild(div);
        });
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function formatDuration(ms) {
        if (ms < 1000) {
            return `${ms}ms`;
        }
        if (ms < 60000) {
            return `${(ms / 1000).toFixed(1)}s`;
        }
        const minutes = Math.floor(ms / 60000);
        const seconds = ((ms % 60000) / 1000).toFixed(0);
        return `${minutes}m${seconds}s`;
    }

    // ---- 初始化 ----
    // 通知 Extension，Webview 已准备就绪
    vscode.postMessage({ command: 'ready' });
})();
