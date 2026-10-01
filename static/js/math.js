/* TeX stays hidden until SVG rendering succeeds; plain text works without CDN. */
(() => {
  'use strict';
  let queue = Promise.resolve();
  const getRoot = () => document.getElementById('favos-page');
  function render(scope = getRoot()) {
    if (!scope || !window.MathJax?.typesetPromise) return Promise.resolve();
    queue = queue.then(async () => {
      const items = [...scope.querySelectorAll('.fp-math:not(.fp-math-ready)')];
      if (scope.matches?.('.fp-math:not(.fp-math-ready)')) items.unshift(scope);
      const pending = items.filter(item => item.isConnected).map(item => {
        const output = item.querySelector('.fp-math-render');
        const display = item.dataset.display === 'true';
        output.textContent = `${display ? '\\[' : '\\('}${item.dataset.tex}${display ? '\\]' : '\\)'}`;
        output.hidden = false;
        output.style.visibility = 'hidden';
        return {item,output};
      });
      if (!pending.length) return;
      try {
        await window.MathJax.typesetPromise(pending.map(p => p.output));
        for (const {item,output} of pending) {
          if (!item.isConnected) { window.MathJax.typesetClear?.([output]); continue; }
          if (output.querySelector('mjx-container[jax="SVG"] svg') && !output.querySelector('[data-mml-node="merror"]')) {
            item.querySelector('.fp-math-fallback').hidden = true;
            output.style.visibility = '';
            item.classList.add('fp-math-ready');
          } else output.hidden = true;
        }
      } catch {
        for (const {output} of pending) output.hidden = true;
      }
    });
    return queue;
  }
  function replace(element, markup) {
    // Forget removed MathItems before inserting new TeX, even on rapid flips.
    window.MathJax?.typesetClear?.([element]);
    element.innerHTML = markup;
    return render(element);
  }
  window.FaVOSMath = {render,replace};
  // Typeset only this page, so a host document's math remains untouched.
  if (!window.MathJax) window.MathJax = {
    tex: {inlineMath:[['\\(','\\)']],displayMath:[['\\[','\\]']],packages:['base','ams']},
    svg: {fontCache:'local'},
    options: {enableMenu:false},
    startup: {
      typeset:false,
      ready() {
        window.MathJax.startup.defaultReady();
        window.MathJax.startup.promise.then(() => render());
      }
    }
  };
  else if (window.MathJax.startup?.promise) window.MathJax.startup.promise.then(() => render());
  document.addEventListener('DOMContentLoaded',() => render());
})();
