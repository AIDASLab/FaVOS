/* One playback coordinator for the two passive illustrations. */
(() => {
  'use strict';
  const page=document.getElementById('favos-page');
  const films=[...page.querySelectorAll('.fp-volume-film')].map(figure => ({
    figure, video:figure.querySelector('video'), poster:figure.querySelector('img'),
    source:figure.querySelector('source'), visible:false, visitorPaused:false,
    automaticPauses:0, starting:false, generation:0, failed:false, denied:false
  }));
  if (!films.length) return;
  const preference=window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const stateFor=video => films.find(state => state.video===video);
  const otherPlaying=() => [...page.querySelectorAll('video')].some(video => !stateFor(video) && !video.paused && !video.ended);
  function cancelStart(state) {
    if (state.starting) { state.generation++; state.starting=false; }
  }
  function still(state) {
    cancelStart(state); state.video.autoplay=false;
    if (!state.video.paused) { state.automaticPauses++; state.video.pause(); }
    state.video.hidden=true; state.poster.hidden=false;
  }
  function reveal(state) { state.video.hidden=false; state.poster.hidden=true; }
  function load(state) {
    if (!state.source.hasAttribute('src')) {
      // The unloaded poster is also the no-JS/reduced-motion fallback.
      state.source.src=state.source.dataset.src; state.video.load();
    }
  }
  function sync() {
    const reduced=preference?.matches;
    films.forEach(state => {
      state.video.autoplay=false;
      if (reduced || document.hidden || !state.visible || state.failed) still(state);
      else if (state.visitorPaused) reveal(state);
    });
    if (reduced || document.hidden) return;
    if (otherPlaying()) { films.forEach(still); return; }
    // Keep an active film instead of letting observer callbacks steal playback.
    const active=films.find(state => !state.video.paused || state.starting);
    if (active) { active.video.autoplay=true; return; }
    const next=films.find(state => state.visible && !state.visitorPaused && !state.failed && !state.denied);
    if (!next) return;
    next.starting=true; const generation=++next.generation;
    next.video.autoplay=true; load(next); reveal(next);
    const result=next.video.play();
    result?.then(() => {
      if (generation!==next.generation) return;
      next.starting=false; sync();
    },error => {
      if (generation!==next.generation) return; // An automatic pause cancelled it.
      next.starting=false;
      if (preference?.matches || document.hidden || !next.visible || next.video.error) {
        still(next); sync(); return;
      }
      // A cancelled play is not an autoplay denial. It can retry on the next
      // visibility event; NotAllowedError instead leaves native Play available.
      if (error?.name!=='AbortError') next.denied=true;
      reveal(next);
    });
  }
  page.addEventListener('play',event => {
    if (event.target.tagName!=='VIDEO') return;
    const current=stateFor(event.target);
    if (!current) { films.forEach(still); return; }
    if (preference?.matches || document.hidden || !current.visible || current.failed) { still(current); return; }
    films.filter(state => state!==current).forEach(still);
    // Explicit native Play may take over, while automatic playback waits for
    // all challenge/comparison/gallery videos to finish or pause first.
    if (!current.starting) page.querySelectorAll('video').forEach(video => {
      if (video!==current.video && !stateFor(video) && !video.paused) video.pause();
    });
  },true);
  films.forEach(state => {
    state.video.addEventListener('play',event => {
      if (preference?.matches || document.hidden || !state.visible || state.failed) { still(state); event.stopImmediatePropagation(); return; }
      state.visitorPaused=false; state.denied=false; reveal(state);
      // Register before index.js so it cannot mistake this autoplay for a
      // visitor starting one of the challenge or gallery clips.
      event.stopImmediatePropagation();
    });
    state.video.addEventListener('pause',() => {
      if (state.automaticPauses) { state.automaticPauses--; return; }
      cancelStart(state); state.visitorPaused=true; state.video.autoplay=false;
    });
    state.video.addEventListener('playing',() => {
      if (preference?.matches || document.hidden || !state.visible) still(state);
      else reveal(state);
    });
    const fail=() => { state.failed=true; still(state); sync(); };
    state.video.addEventListener('error',fail); state.source.addEventListener('error',fail);
  });
  preference?.addEventListener?.('change',sync);
  document.addEventListener('visibilitychange',sync);
  // Resume a visible illustration only after the foreground clip is idle.
  page.addEventListener('pause',event => { if (!stateFor(event.target)) sync(); },true);
  page.addEventListener('ended',event => { if (!stateFor(event.target)) sync(); },true);
  if ('IntersectionObserver' in window) {
    const observer=new IntersectionObserver(entries => {
      entries.forEach(entry => { const state=films.find(item => item.figure===entry.target);
        if (state) state.visible=entry.isIntersecting && entry.intersectionRatio>=0.1;
      }); sync();
    },{threshold:0.1});
    films.forEach(state => observer.observe(state.figure));
  } else { films.forEach(state => { state.visible=true; }); }
  sync();
})();
