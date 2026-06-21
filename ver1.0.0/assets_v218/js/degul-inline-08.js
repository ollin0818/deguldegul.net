/* ===== ver211: 설정창 볼륨 슬라이더 블럭 롤링 동기화 ===== */
(function () {
  function updateDegulVolumeSlider(input, animate) {
    if (!input) return;
    const min = Number(input.min || 0);
    const max = Number(input.max || 100);
    const value = Number(input.value || 0);
    const percent = max === min ? 0 : Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
    input.style.setProperty('--volumePercent', percent + '%');
    input.style.setProperty('--volumeDeg', (percent * 7.2) + 'deg');

    if (animate) {
      input.classList.remove('is-rolling');
      void input.offsetWidth;
      input.classList.add('is-rolling');
      window.clearTimeout(input._degulRollTimer);
      input._degulRollTimer = window.setTimeout(function () {
        input.classList.remove('is-rolling');
      }, 300);
    }
  }

  function bindDegulVolumeSliders() {
    document.querySelectorAll('.settingsVolumeControl input[type="range"]').forEach(function (input) {
      if (input.dataset.degulSliderReady === '1') {
        updateDegulVolumeSlider(input, false);
        return;
      }
      input.dataset.degulSliderReady = '1';
      updateDegulVolumeSlider(input, false);
      input.addEventListener('input', function () { updateDegulVolumeSlider(input, true); });
      input.addEventListener('change', function () { updateDegulVolumeSlider(input, true); });
      input.addEventListener('pointerdown', function () { input.classList.add('is-rolling'); });
      input.addEventListener('pointerup', function () { updateDegulVolumeSlider(input, false); input.classList.remove('is-rolling'); });
      input.addEventListener('pointercancel', function () { input.classList.remove('is-rolling'); });
      input.addEventListener('mouseleave', function () { input.classList.remove('is-rolling'); });
      input.addEventListener('keydown', function () { window.requestAnimationFrame(function () { updateDegulVolumeSlider(input, true); }); });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindDegulVolumeSliders);
  } else {
    bindDegulVolumeSliders();
  }
  window.addEventListener('load', bindDegulVolumeSliders);
  window.updateDegulVolumeSlider = updateDegulVolumeSlider;
})();
