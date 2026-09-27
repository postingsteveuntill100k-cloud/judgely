// Hackerly 3D Universe — Interactive Hackathon Constellation & Network
(function(window) {
  'use strict';

  let renderer = null;
  let scene = null;
  let camera = null;
  let animationFrameId = null;
  let observer = null;
  let isVisible = true;
  let targetRotationX = 0;
  let targetRotationY = 0;
  let mouseX = 0;
  let mouseY = 0;

  function init(canvasId) {
    const canvas = document.getElementById(canvasId || 'hackerly-universe-canvas');
    if (!canvas) return;

    // Graceful degradation checks
    if (!window.THREE) {
      console.info('Three.js not loaded, falling back to CSS background.');
      return;
    }

    const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // WebGL capability check
    try {
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) {
        console.info('WebGL not supported, falling back to CSS.');
        return;
      }
    } catch (e) {
      return;
    }

    // Clean up any existing instance
    destroy();

    const parent = canvas.parentElement;
    const width = parent ? parent.clientWidth : window.innerWidth;
    const height = parent ? Math.max(parent.clientHeight, 380) : 460;

    // Scene & Camera
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(50, width / height, 1, 1000);
    camera.position.z = 180;

    // Renderer
    try {
      renderer = new THREE.WebGLRenderer({
        canvas: canvas,
        alpha: true,
        antialias: true,
        powerPreference: 'low-power'
      });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    } catch (e) {
      console.warn('Could not initialize WebGLRenderer:', e);
      return;
    }

    // Constellation Geometry: 65 nodes representing builders, hackathons, and projects
    const nodeCount = 65;
    const coords = [];
    const colors = [];
    const nodePositions = [];

    // Curated palette: Indigo, Cyan, Emerald, Warm White
    const palette = [
      new THREE.Color(0x818cf8), // Soft indigo
      new THREE.Color(0x38bdf8), // Cyan
      new THREE.Color(0x34d399), // Emerald
      new THREE.Color(0xf8fafc)  // Warm white
    ];

    for (let i = 0; i < nodeCount; i++) {
      const x = (Math.random() - 0.5) * 220;
      const y = (Math.random() - 0.5) * 110;
      const z = (Math.random() - 0.5) * 120;
      coords.push(x, y, z);
      nodePositions.push(new THREE.Vector3(x, y, z));

      const color = palette[Math.floor(Math.random() * palette.length)];
      colors.push(color.r, color.g, color.b);
    }

    // Point cloud
    const pointsGeometry = new THREE.BufferGeometry();
    pointsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(coords, 3));
    pointsGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    // Custom circular soft texture for points
    const canvasTexture = document.createElement('canvas');
    canvasTexture.width = 32;
    canvasTexture.height = 32;
    const ctx = canvasTexture.getContext('2d');
    const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(0.4, 'rgba(129, 140, 248, 0.8)');
    grad.addColorStop(1, 'rgba(10, 14, 23, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(16, 16, 16, 0, Math.PI * 2);
    ctx.fill();

    const pTexture = new THREE.CanvasTexture(canvasTexture);

    const pointsMaterial = new THREE.PointsMaterial({
      size: 5,
      map: pTexture,
      transparent: true,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    const pointCloud = new THREE.Points(pointsGeometry, pointsMaterial);
    scene.add(pointCloud);

    // Dynamic Connection Lines (links between proximate nodes)
    const lineIndices = [];
    const maxDistance = 46;

    for (let i = 0; i < nodeCount; i++) {
      for (let j = i + 1; j < nodeCount; j++) {
        const dist = nodePositions[i].distanceTo(nodePositions[j]);
        if (dist < maxDistance) {
          lineIndices.push(i, j);
        }
      }
    }

    const linesGeometry = new THREE.BufferGeometry();
    linesGeometry.setAttribute('position', new THREE.Float32BufferAttribute(coords, 3));
    linesGeometry.setIndex(lineIndices);

    const linesMaterial = new THREE.LineBasicMaterial({
      color: 0x6366f1,
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending
    });

    const networkLines = new THREE.LineSegments(linesGeometry, linesMaterial);
    scene.add(networkLines);

    // Subtle interactive pointer listener
    function onPointerMove(e) {
      const halfX = window.innerWidth / 2;
      const halfY = window.innerHeight / 2;
      mouseX = (e.clientX - halfX) / halfX;
      mouseY = (e.clientY - halfY) / halfY;
      targetRotationY = mouseX * 0.35;
      targetRotationX = mouseY * 0.2;
    }

    window.addEventListener('pointermove', onPointerMove, { passive: true });

    // Responsive resize handler
    function onResize() {
      if (!renderer || !camera || !canvas) return;
      const currentParent = canvas.parentElement;
      const w = currentParent ? currentParent.clientWidth : window.innerWidth;
      const h = currentParent ? Math.max(currentParent.clientHeight, 380) : 460;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }

    window.addEventListener('resize', onResize);

    // IntersectionObserver to pause rendering when hero is not visible
    if ('IntersectionObserver' in window && canvas) {
      observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          isVisible = entry.isIntersecting;
        });
      }, { threshold: 0.05 });
      observer.observe(canvas);
    }

    // Animation Loop
    function animate() {
      if (prefersReducedMotion) {
        renderer.render(scene, camera);
        return; // Render static frame only
      }

      animationFrameId = requestAnimationFrame(animate);

      if (!isVisible) return; // Save CPU/GPU cycles when offscreen

      // Gentle continuous rotation
      scene.rotation.y += 0.0012;
      scene.rotation.x += 0.0004;

      // Smooth dampening towards mouse pointer
      scene.rotation.y += (targetRotationY - scene.rotation.y) * 0.03;
      scene.rotation.x += (targetRotationX - scene.rotation.x) * 0.03;

      renderer.render(scene, camera);
    }

    animate();
  }

  function destroy() {
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (renderer) {
      try {
        renderer.dispose();
      } catch (e) {}
      renderer = null;
    }
    scene = null;
    camera = null;
  }

  window.HackerlyUniverse = {
    init: init,
    destroy: destroy
  };
})(window);
