(function(){
  const els = {
    baseUrl: document.getElementById('baseUrl'),
    saveCfg: document.getElementById('saveCfg'),
    useLocal: document.getElementById('useLocal'),
    model: document.getElementById('model'),
    reply: document.getElementById('reply'),
    logs: document.getElementById('logs'),
    cfgBackend: document.getElementById('cfgBackend'),
    // chat
    chatBox: document.getElementById('chatBox'),
    chatInput: document.getElementById('chatInput'),
    chatSend: document.getElementById('chatSend'),
    chatClear: document.getElementById('chatClear'),
  };

  const KEY = 'dex_cfg_v1';

  function loadCfg(){
    try{
      const raw = localStorage.getItem(KEY);
      if(!raw) return;
      const obj = JSON.parse(raw);
      if(obj.baseUrl) els.baseUrl.value = obj.baseUrl;
      renderCfg();
    }catch{}
  }

  async function doInterpret(){
    const baseUrl = (els.baseUrl.value||'').trim();
    if(!baseUrl){ alert('Defina a base URL'); return; }
    const q = (els.question.value||'').trim();
    if(!q){ alert('Escreva uma pergunta'); return; }
    try{
      els.btnInterpret.disabled = true;
      els.model.textContent = '';
      els.timing.textContent = '';
      els.sql.textContent = '';
      els.interp.textContent = '';
      els.table.innerHTML = '';
      els.raw.textContent = '';
      els.logs.textContent = '';

      const url = baseUrl.replace(/\/$/, '') + '/qa/interpret';
      const payload = { question: q };
      const t0 = performance.now();
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const text = await res.text();
      const t1 = performance.now();
      let data;
      try { data = JSON.parse(text); } catch { data = { _raw: text }; }

      els.raw.textContent = JSON.stringify(data, null, 2);
      els.logs.textContent = [
        `POST ${url}`,
        `status: ${res.status}`,
        `duration_ms: ${Math.round(t1 - t0)}`,
        'payload: ' + JSON.stringify(payload),
        'response: ' + (typeof data==='object'? JSON.stringify(data) : String(data))
      ].join('\n');

      if(!res.ok || !data.ok){
        const msg = (data?.detail?.message || data?.detail || res.status);
        alert('Falha: ' + msg);
        return;
      }

      els.model.textContent = data.model || '-';
      els.timing.textContent = data.timing_ms ?? '-';
      els.interp.textContent = JSON.stringify(data.interpretation, null, 2);
    } catch (e){
      alert('Erro: ' + e);
    } finally {
      els.btnInterpret.disabled = false;
    }
  }
  function saveCfg(){
    const obj = { baseUrl: (els.baseUrl.value||'').trim() };
    localStorage.setItem(KEY, JSON.stringify(obj));
    renderCfg();
  }
  function renderCfg(){
    const url = (els.baseUrl.value||'').trim();
    if(els.cfgBackend) els.cfgBackend.textContent = url || '(defina acima)';
  }

  // --- Chat ---
  const chat = { history: [] };
  function chatAppend(role, content){
    chat.history.push({ role, content });
    const div = document.createElement('div');
    div.style.margin = '4px 0';
    div.innerHTML = `<b>${role}:</b> ${content}`;
    els.chatBox.appendChild(div);
    els.chatBox.scrollTop = els.chatBox.scrollHeight;
  }
  async function chatSend(){
    const msg = (els.chatInput.value||'').trim();
    if(!msg) return;
    els.chatInput.value = '';
    chatAppend('user', msg);
    // call backend
    const baseUrl = (els.baseUrl.value||'').trim();
    if(!baseUrl){ alert('Defina a base URL'); return; }
    try{
      const url = baseUrl.replace(/\/$/, '') + '/chat/echo';
      const payload = { history: chat.history };
      const t0 = performance.now();
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const text = await res.text();
      const t1 = performance.now();
      let data;
      try { data = JSON.parse(text); } catch { data = { _raw: text }; }
      els.logs.textContent = [
        `POST ${url}`,
        `status: ${res.status}`,
        `duration_ms: ${Math.round(t1 - t0)}`,
        'payload: ' + JSON.stringify(payload),
        'response: ' + (typeof data==='object'? JSON.stringify(data) : String(data))
      ].join('\n');
      if(!res.ok || !data.ok){
        alert('Falha: ' + (data?.detail?.message || data?.detail || res.status));
        return;
      }
      els.model.textContent = data.model || '-';
      els.reply.textContent = data.reply || '';
      chatAppend('assistant', data.reply || '(vazio)');
    }catch(e){
      alert('Erro: ' + e);
    }
  }
  function chatClear(){
    chat.history = [];
    els.chatBox.innerHTML = '';
    els.reply.textContent = '';
    els.model.textContent = '';
    }

  async function ask(){
    const baseUrl = (els.baseUrl.value||'').trim();
    if(!baseUrl){ alert('Defina a base URL'); return; }
    const q = (els.question.value||'').trim();
    if(!q){ alert('Escreva uma pergunta'); return; }
    try{
      els.btnAsk.disabled = true;
      els.model.textContent = '';
      els.timing.textContent = '';
      els.sql.textContent = '';
      els.interp.textContent = '';
      els.table.innerHTML = '';
      els.raw.textContent = '';
      els.logs.textContent = '';

      const url = baseUrl.replace(/\/$/, '') + '/qa/ask';
      const payload = { question: q };
      const t0 = performance.now();
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const text = await res.text();
      const t1 = performance.now();
      let data;
      try { data = JSON.parse(text); } catch { data = { _raw: text }; }

      els.raw.textContent = JSON.stringify(data, null, 2);
      els.logs.textContent = [
        `POST ${url}`,
        `status: ${res.status}`,
        `duration_ms: ${Math.round(t1 - t0)}`,
        'payload: ' + JSON.stringify(payload),
        'response: ' + (typeof data==='object'? JSON.stringify(data) : String(data))
      ].join('\n');

      if(!res.ok || !data.ok){
        const msg = (data?.detail?.message || data?.detail || res.status);
        alert('Falha: ' + msg);
        if(data?.detail?.sql){ els.sql.textContent = data.detail.sql; }
        return;
      }

      els.model.textContent = data.model || '-';
      els.timing.textContent = data.timing_ms ?? '-';
      els.sql.textContent = data.executed_sql || '-';
      els.interp.textContent = data.explanation || data.rationale || '-';

      if(Array.isArray(data.columns) && Array.isArray(data.rows)){
        const tbl = document.createElement('table');
        const thead = document.createElement('thead');
        const trh = document.createElement('tr');
        (data.columns||[]).forEach(c=>{
          const th = document.createElement('th'); th.textContent = c; trh.appendChild(th);
        });
        thead.appendChild(trh);
        tbl.appendChild(thead);
        const tbody = document.createElement('tbody');
        (data.rows||[]).forEach(r=>{
          const tr = document.createElement('tr');
          (data.columns||[]).forEach((c,idx)=>{
            const td = document.createElement('td');
            const v = r[idx];
            td.textContent = v==null ? '' : (typeof v==='object'? JSON.stringify(v) : String(v));
            tr.appendChild(td);
          });
          tbody.appendChild(tr);
        });
        tbl.appendChild(tbody);
        els.table.innerHTML='';
        els.table.appendChild(tbl);
      }

    }catch(e){
      alert('Erro: ' + e);
    }finally{
      els.btnAsk.disabled = false;
    }
  }

  // Init
  loadCfg();
  els.saveCfg.addEventListener('click', saveCfg);
  els.useLocal.addEventListener('click', ()=>{ els.baseUrl.value='http://127.0.0.1:8000'; saveCfg(); });
  els.chatSend.addEventListener('click', chatSend);
  els.chatClear.addEventListener('click', chatClear);
})();
