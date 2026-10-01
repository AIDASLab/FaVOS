/* Scoped to the project page so embedding does not affect the host's UI. */
(() => {
  'use strict';
  const root = document.getElementById('favos-page');
  if (!root) return;
  const $ = selector => root.querySelector(selector);
  const $$ = selector => [...root.querySelectorAll(selector)];
  $$('[data-placeholder]').forEach(link => link.addEventListener('click', event => {
    event.preventDefault();
    $('#resource-status').textContent = `${link.textContent.replace('TODO', '').trim()} link: TODO, public URL pending.`;
  }));

  const video = $('#challenge-video');
  const data = JSON.parse($('#challenge-data').textContent);
  const play = $('#challenge-play');
  const mark = $('#challenge-mark');
  const hit = $('#challenge-hit');
  const result = $('#challenge-result');
  let phase = 'ready';
  let clicks = [];
  let metric = 'jf';
  const JF = String.raw`\mathcal{J}\&\mathcal{F}`;
  const JFV = String.raw`\mathcal{J}\&\mathcal{F}_v`;
  const escapeHTML = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
  const math = (tex,plain) => `<span class="fp-math" data-tex="${escapeHTML(tex)}"><span class="fp-math-fallback">${escapeHTML(plain)}</span><span class="fp-math-render" hidden>\\(${escapeHTML(tex)}\\)</span></span>`;
  const replaceMath = (element,markup) => {
    if (window.FaVOSMath) window.FaVOSMath.replace(element,markup);
    else element.innerHTML = markup;
  };
  video.controls = false;
  $('#challenge-controls').hidden = false;
  hit.hidden = false;

  function syncControls() {
    const running = phase === 'playing';
    mark.disabled = hit.disabled = !running;
    play.textContent = ({ready:'Start challenge',playing:'Pause',paused:'Resume',finished:'Replay challenge'})[phase];
  }
  function showMetric(next) {
    metric = next;
    replaceMath($('#headline-metric'),next === 'jf' ? 'Frame-wise '+math(JF,'J&F') : 'Volumetric '+math(JFV,'J&F_v'));
    $('#headline-empty').textContent = data.scores.empty[next];
    $('#headline-sam3').textContent = data.scores.sam3[next];
    replaceMath($('#challenge-flip'),next === 'jf' ? 'Switch to Volumetric '+math(JFV,'J&F_v') : 'Switch to frame-wise '+math(JF,'J&F'));
    if (phase === 'finished') {
      replaceMath($('#challenge-metric-verdict'),next === 'jfv'
        ? `This video, full sequence: ${math(JFV,'J&F_v')}, empty ${data.scores.empty.jfv}, SAM 3 ${data.scores.sam3.jfv}.`
        : `This video, full sequence: ${math(JF,'J&F')}, empty ${data.scores.empty.jf}, SAM 3 ${data.scores.sam3.jf}.`);
      if (!clicks.length) {
        $('#challenge-verdict').textContent = next === 'jfv'
          ? 'Not so fast. SAM 3 wins under volumetric scoring.' : 'You win!';
        result.classList.toggle('fp-win',next === 'jf');
      }
    }
  }
  function recordClick() {
    if (phase !== 'playing' || video.paused || video.ended || video.seeking) return;
    const frame = Math.min(data.visible.length-1,Math.max(0,Math.floor(video.currentTime*data.fps)));
    clicks.push({frame,visible:data.visible[frame],time:video.currentTime});
    $('#challenge-progress').textContent = `${clicks.length} ${clicks.length === 1 ? 'click' : 'clicks'} recorded`;
  }
  mark.addEventListener('click',recordClick);
  hit.addEventListener('click',recordClick);
  play.addEventListener('click',async () => {
    if (phase === 'playing') { video.pause(); return; }
    if (phase === 'ready' || phase === 'finished') {
      clicks = [];
      result.hidden = true;
      result.classList.remove('fp-win');
      video.currentTime = 0;
      showMetric('jf');
      $('#challenge-progress').textContent = '0 clicks recorded';
    }
    try { await video.play(); }
    catch {
      phase = 'ready';
      syncControls();
      $('#challenge-progress').textContent = 'The clip could not start. Try again or use the comparison below.';
    }
  });
  video.addEventListener('play',() => { phase = 'playing'; syncControls(); });
  video.addEventListener('pause',() => {
    if (phase === 'playing') { phase = 'paused'; syncControls(); }
  });
  video.addEventListener('ended',() => {
    if (phase === 'ready' || phase === 'finished') return;
    phase = 'finished';
    const absent = clicks.filter(click => !click.visible).length;
    const won = clicks.length === 0;
    $('#challenge-verdict').textContent = won ? 'You win!' : absent ? 'Some of those clicks found an empty frame.' : 'Good timing.';
    result.classList.toggle('fp-win',won);
    replaceMath($('#challenge-detail'),won
      ? 'Your empty mask beats SAM 3 under frame-wise '+math(JF,'J&F')+'. Now try volumetric scoring.'
      : absent
        ? `${clicks.length === 1 ? 'Your click was on a target-absent frame.' : `${absent} of your ${clicks.length} clicks were on target-absent frames.`} False foreground loses points under ${math(JF,'J&F')}.`
        : `${clicks.length === 1 ? 'Your click was on a target-visible frame.' : `All ${clicks.length} of your clicks were on target-visible frames.`}`);
    result.hidden = false;
    $('#challenge-progress').textContent = 'Finished';
    showMetric('jf');
    syncControls();
    if (won) celebrate();
  });
  function celebrate() {
    result.scrollIntoView({block:'nearest',behavior:'smooth'});
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    root.querySelector('.fp-confetti')?.remove();
    const canvas = document.createElement('canvas');
    canvas.className = 'fp-confetti';
    canvas.setAttribute('aria-hidden','true');
    root.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1,2);
    const w = window.innerWidth, h = window.innerHeight;
    canvas.width = w*dpr; canvas.height = h*dpr;
    ctx.scale(dpr,dpr);
    const colors = ['#b42b21','#e0a526','#315d82','#3f8f5a','#b36035','#7a4fa3'];
    const pieces = [];
    for (let i=0;i<160;i++) {
      const fromLeft = i%2 === 0, angle = (fromLeft ? -60 : -120)+(Math.random()-.5)*50;
      const speed = 9+Math.random()*9, rad = angle*Math.PI/180;
      pieces.push({x:fromLeft ? -10 : w+10, y:h*.75, vx:Math.cos(rad)*speed, vy:Math.sin(rad)*speed,
        size:5+Math.random()*6, color:colors[i%colors.length], rot:Math.random()*6.28, vr:(Math.random()-.5)*.3, tilt:Math.random()*6.28});
    }
    const start = performance.now();
    (function frame(now) {
      const elapsed = now-start;
      ctx.clearRect(0,0,w,h);
      ctx.globalAlpha = Math.max(0,Math.min(1,(3600-elapsed)/800));
      pieces.forEach(p => {
        p.vy += .25; p.vx *= .99; p.vy *= .99; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.tilt += .1;
        ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.color; ctx.fillRect(-p.size/2,-p.size/4,p.size,p.size/2*Math.abs(Math.cos(p.tilt))+1);
        ctx.restore();
      });
      if (elapsed < 3600) requestAnimationFrame(frame); else canvas.remove();
    })(start);
  }
  $('#challenge-flip').addEventListener('click',() => showMetric(metric === 'jf' ? 'jfv' : 'jf'));
  syncControls();

  // Playback is requested by the visitor; no autoplay or automatic replay.
  $$('video').forEach(current => current.addEventListener('play',() => {
    $$('video').filter(other => other !== current).forEach(other => other.pause());
  }));
  document.addEventListener('visibilitychange',() => {
    if (document.hidden) $$('video').forEach(current => current.pause());
  });

  const tau = $('#tau-slider');
  tau.disabled = false;
  const parameterInputs = ['p0','p1','quality'].map(name => $(`#${name}-slider`));
  parameterInputs.forEach(input => { input.disabled = false; input.addEventListener('input',updateTau); });
  function updateTau() {
    const visibility = Number(tau.value)/100;
    const [p0,p1,s] = parameterInputs.map(input => Number(input.value));
    const ratios = t => {
      const absence = (1-t)*p0, segmentation = t*p1*s, total = absence+segmentation;
      return total > 0 ? [absence/total,segmentation/total] : null;
    };
    parameterInputs.forEach(input => {
      $(`#${input.id.replace('-slider','-value')}`).textContent = Number(input.value).toFixed(2);
      input.setAttribute('aria-valuetext',Number(input.value).toFixed(2)+' out of 1');
    });
    $('#tau-value').textContent = `${tau.value}%`;
    tau.setAttribute('aria-valuetext',`${tau.value} percent of frames visible`);
    const x = t => 54+522*t, y = r => 250-230*r;
    const paths = ['','']; let connected = false;
    for (let i=0;i<=200;i++) {
      const t=i/200, r=ratios(t);
      if (!r) { connected=false; continue; }
      r.forEach((value,k) => { paths[k] += `${connected?'L':'M'}${x(t).toFixed(2)},${y(value).toFixed(2)} `; });
      connected=true;
    }
    $('#contribution-cls').setAttribute('d',paths[0].trim());
    $('#contribution-seg').setAttribute('d',paths[1].trim());
    const crossover = p0+p1*s > 0 ? p0/(p0+p1*s) : null;
    const line = $('#contribution-crossover');
    line.style.display = crossover === null ? 'none' : '';
    if (crossover !== null) { line.setAttribute('x1',x(crossover)); line.setAttribute('x2',x(crossover)); }
    $('#crossover-value').textContent = crossover === null ? 'undefined' : crossover.toFixed(2);
    $('#contribution-boundary').textContent = crossover === null
      ? 'Both terms are zero at every visibility.'
      : crossover === 0 || crossover === 1 ? 'This is a boundary value; ratios are undefined at that endpoint.' : '';
    const current = ratios(visibility);
    ['cls','seg'].forEach((name,k) => {
      const marker=$(`#contribution-${name}-marker`);
      marker.style.display=current ? '' : 'none';
      if (current) { marker.setAttribute('cx',x(visibility)); marker.setAttribute('cy',y(current[k])); }
    });
    const reading = current
      ? `absence makes up ${Math.round(100*current[0])}% of the score.`
      : 'the score is zero; contributions are undefined.';
    $('#contribution-visibility').textContent = `${tau.value}%`;
    $('#contribution-reading').textContent = reading;
    const summary = `At visibility ${tau.value}%, ${reading}`;
    const chartSummary = current
      ? `At visibility ${tau.value}%, absence contributes ${(100*current[0]).toFixed(1)}% and segmentation contributes ${(100*current[1]).toFixed(1)}%.`
      : summary;
    $('#favos-contribution-summary').textContent=`Absence correctness ${p0.toFixed(2)}, presence correctness ${p1.toFixed(2)}, segmentation quality ${s.toFixed(2)}. Crossover ${crossover === null ? 'undefined' : crossover.toFixed(2)}. ${chartSummary}`;
  }
  tau.addEventListener('input',updateTau);
  updateTau();

  const copy = $('#copy-bibtex');
  copy.hidden = false;
  copy.addEventListener('click',async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText($('#bibtex').textContent);
      copy.textContent = 'Copied';
      $('#copy-status').textContent = 'Citation copied.';
    } catch {
      const range = document.createRange();
      range.selectNodeContents($('#bibtex'));
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      copy.textContent = 'Citation selected';
      $('#copy-status').textContent = 'Citation selected. Use your browser’s Copy command.';
    }
  });
})();
