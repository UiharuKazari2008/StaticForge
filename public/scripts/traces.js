// Minimal traces viewer using existing dropdown system
(function () {
  const traceDropdown = document.getElementById('traceDropdown');
  const traceDropdownBtn = document.getElementById('traceDropdownBtn');
  const traceDropdownMenu = document.getElementById('traceDropdownMenu');
  const traceDropdownSelected = document.getElementById('traceDropdownSelected');
  const traceDropdownHidden = document.getElementById('traceDropdownHidden');
  const traceDetails = document.getElementById('traceDetails');

  let traces = [];
  let selectedTraceId = '';

  function fmtTime(ts) {
    try { return new Date(ts).toLocaleString(); } catch { return String(ts); }
  }

  function selectTrace(id) {
    selectedTraceId = id;
    traceDropdownHidden.value = id;
    const item = traces.find(t => t.id === id);
    traceDropdownSelected.textContent = item ? `${item.id} (${item.status})` : 'Select trace...';
    renderTrace(id);
  }

  function closeTraceDropdown() {
    if (typeof closeDropdown === 'function') closeDropdown(traceDropdownMenu, traceDropdownBtn);
  }

  function renderTraceOptions() {
    const items = traces.map(t => ({ value: t.id, name: `${t.id} • ${fmtTime(t.startedAt)} • ${t.status}` }));
    if (typeof renderSimpleDropdown === 'function') {
      renderSimpleDropdown(
        traceDropdownMenu,
        items,
        'value',
        'name',
        (val) => { selectTrace(val); },
        closeTraceDropdown,
        selectedTraceId,
        { preventFocusTransfer: true }
      );
    } else {
      // Fallback basic render
      traceDropdownMenu.innerHTML = '';
      items.forEach(opt => {
        const el = document.createElement('div');
        el.className = 'custom-dropdown-option' + (selectedTraceId === opt.value ? ' selected' : '');
        el.textContent = opt.name;
        el.addEventListener('click', () => { selectTrace(opt.value); closeTraceDropdown(); });
        traceDropdownMenu.appendChild(el);
      });
    }
  }

  function formatAIContent(content) {
    if (typeof content === 'string') {
      return content.split('\n').map(line => `<div>${escapeHtml(line)}</div>`).join('');
    }
    if (Array.isArray(content)) {
      return content.map(item => {
        if (item.type === 'text') {
          return `<div>${escapeHtml(item.text).split('\n').map(l => `<div>${l}</div>`).join('')}</div>`;
        }
        if (item.type === 'image_url') {
          const url = item.image_url?.url || '';
          if (url.startsWith('data:image')) {
            return `<div class="trace-ai-image"><strong>[Image]</strong> <img src="${url}"/></div>`;
          }
          return `<div><strong>[Image URL]</strong> ${escapeHtml(url.substring(0, 100))}...</div>`;
        }
        return `<div><strong>[${item.type}]</strong> ${escapeHtml(JSON.stringify(item))}</div>`;
      }).join('<hr style="margin:8px 0;border-color:#333;"/>');
    }
    return escapeHtml(JSON.stringify(content, null, 2));
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function renderTrace(id) {
    if (!id) { traceDetails.innerHTML = ''; return; }
    fetch(`/traces/${encodeURIComponent(id)}`)
      .then(r => r.json())
      .then(data => {
        if (!data.success) { traceDetails.textContent = data.error || 'Failed to load trace'; return; }
        const t = data.trace;
        
        // Collect all images from attachments
        const attachmentImages = (t.attachments || []).filter(a => a.type === 'image').map(a => {
          const src = `/traces/files/${a.path}`;
          return `<div class="trace-image-attachment">
            <div class="trace-image-attachment-label">${escapeHtml(a.label || 'image')}</div>
            ${a.width || a.height ? `<div class="trace-image-attachment-dimensions">${a.width || '?'}x${a.height || '?'}</div>` : ''}
            <img src="${src}" alt="${escapeHtml(a.label || '')}"/>
          </div>`;
        }).join('');

        // Process events with proper formatting
        const eventsHtml = (t.events || []).map(e => {
          const ts = fmtTime(e.timestamp);
          
          if (e.type === 'build_options') {
            const opts = e.options || {};
            let optsHtml = '<div class="trace-event-content"><div class="trace-build-options"><strong>Options:</strong><pre>';
            optsHtml += escapeHtml(JSON.stringify(opts, null, 2));
            optsHtml += '</pre></div>';
            
            // Extract and show input/mask images if present
            if (opts.image && typeof opts.image === 'string') {
              if (opts.image.startsWith('data:image')) {
                optsHtml += `<div class="trace-image-preview"><strong>Input Image:</strong><br/><img src="${opts.image}"/></div>`;
              } else {
                optsHtml += `<div class="trace-image-preview"><strong>Input Image:</strong> ${escapeHtml(opts.image.substring(0, 100))}...</div>`;
              }
            }
            if (opts.mask && typeof opts.mask === 'string') {
              if (opts.mask.startsWith('data:image')) {
                optsHtml += `<div class="trace-image-preview"><strong>Mask:</strong><br/><img src="${opts.mask}"/></div>`;
              } else {
                optsHtml += `<div class="trace-image-preview"><strong>Mask:</strong> ${escapeHtml(opts.mask.substring(0, 100))}...</div>`;
              }
            }
            if (opts.mask_compressed && typeof opts.mask_compressed === 'string') {
              optsHtml += `<div class="trace-image-preview"><strong>Mask (compressed):</strong> ${escapeHtml(opts.mask_compressed.substring(0, 100))}...</div>`;
            }
            
            optsHtml += '</div>';
            return `<details class="trace-event"><summary>[${ts}] ${e.type}</summary>${optsHtml}</details>`;
          }
          
          if (e.type === 'ai_messages_pre' || e.type === 'ai_message') {
            const messages = e.messages || (e.role ? [{ role: e.role, content: e.content }] : []);
            let msgHtml = '<div class="trace-event-content"><div class="trace-ai-messages">';
            messages.forEach((msg, idx) => {
              msgHtml += `<div class="trace-ai-message ${msg.role}">`;
              msgHtml += `<div class="trace-ai-message-role"><strong>${escapeHtml(msg.role)}</strong></div>`;
              msgHtml += `<div class="trace-ai-message-content">${formatAIContent(msg.content)}</div>`;
              msgHtml += '</div>';
            });
            msgHtml += '</div></div>';
            return `<details class="trace-event"><summary>[${ts}] ${e.type}</summary>${msgHtml}</details>`;
          }
          
          if (e.type === 'ai_response' || e.type === 'ai_candidate_data') {
            const dataStr = JSON.stringify(e.raw || e.data || e, null, 2);
            return `<details class="trace-event"><summary>[${ts}] ${e.type}</summary><div class="trace-event-content"><pre class="trace-ai-response">${escapeHtml(dataStr)}</pre></div></details>`;
          }
          
          if (e.type === 'request_body') {
            const bodyStr = JSON.stringify(e.body || e, null, 2);
            return `<details class="trace-event"><summary>[${ts}] ${e.type}</summary><div class="trace-event-content"><pre class="trace-request-body">${escapeHtml(bodyStr)}</pre></div></details>`;
          }
          
          return `<div class="trace-event"><div class="trace-event-content">[${ts}] <strong>${escapeHtml(e.type)}</strong></div></div>`;
        }).join('');

        const html = `
          <div class="trace-container">
            <div class="trace-header">
              <div class="trace-header-item"><strong>Trace ID</strong>: ${escapeHtml(t.id)}</div>
              <div class="trace-header-item"><strong>Status</strong>: ${escapeHtml(t.status)}${t.endedAt ? ` • ended ${fmtTime(t.endedAt)}` : ''}</div>
              <div class="trace-header-item"><strong>Started</strong>: ${fmtTime(t.startedAt)}</div>
              ${t.context ? `<div class="trace-header-item trace-context"><strong>Context</strong>: <pre>${escapeHtml(JSON.stringify(t.context, null, 2))}</pre></div>` : ''}
            </div>
            <hr class="trace-divider"/>
            <div class="trace-section">
              <h3 class="trace-section-title">Events & Data</h3>
              <div>${eventsHtml || '<div class="trace-empty">No events recorded.</div>'}</div>
            </div>
            <hr class="trace-divider"/>
            <div class="trace-section">
              <h3 class="trace-section-title">Image Attachments</h3>
              <div class="trace-image-attachments">${attachmentImages || '<div class="trace-empty">No images recorded.</div>'}</div>
            </div>
          </div>
        `;
        traceDetails.innerHTML = html;
      })
      .catch(() => { traceDetails.textContent = 'Failed to load trace'; });
  }

  function init() {
    // Dropdown setup
    if (typeof setupDropdown === 'function') {
      setupDropdown(
        traceDropdown,
        traceDropdownBtn,
        traceDropdownMenu,
        () => renderTraceOptions(),
        () => selectedTraceId,
        { preventFocusTransfer: true }
      );
    }

    // Load list
    fetch('/traces/list')
      .then(r => r.json())
      .then(data => {
        if (!data.success) return;
        traces = data.traces || [];
        renderTraceOptions();
      })
      .catch(() => {});
  }

  document.addEventListener('DOMContentLoaded', init);
})();


