// Hackerly Spatial Network — Subtle Architectural Constellation for Light Canvas
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
      return;
    }

    const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // WebGL capability check
    try {
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) {
        return;
      }
    } catch (e) {
      return;
    }

    // Clean up any existing instance
    destroy();

    const parent = canvas.parentElement;
    const width = parent ? parent.clientWidth : window.innerWidth;
    const height = parent ? Math.max(parent.clientHeight, 360) : 420;

    // Scene & Camera
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, width / height, 1, 1000);
    camera.position.z = 190;

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
      return;
    }

    // Constellation Geometry: 55 nodes representing builders, hackathons, and teams
    const nodeCount = 55;
    const coords = [];
    const colors = [];
    const nodePositions = [];

    // Curated light-canvas palette: subtle slate, soft neutral gray, restrained indigo accent
    const palette = [
      new THREE.Color(0x64748b), // Slate
      new THREE.Color(0x94a3b8), // Soft gray
      new THREE.Color(0x4f46e5), // Restrained Hackerly Indigo
      new THREE.Color(0x0f766e)  // Subdued teal
    ];

    for (let i = 0; i < nodeCount; i++) {
      const x = (Math.random() - 0.5) * 240;
      const y = (Math.random() - 0.5) * 110;
      const z = (Math.random() - 0.5) * 100;
      coords.push(x, y, z);
      nodePositions.push(new THREE.Vector3(x, y, z));

      // 80% slate/neutral, 20% restrained indigo/teal
      const isAccent = Math.random() < 0.25;
      const color = isAccent ? palette[Math.random() < 0.7 ? 2 : 3] : palette[Math.random() < 0.5 ? 0 : 1];
      colors.push(color.r, color.g, color.b);
    }

    // Point cloud
    const pointsGeometry = new THREE.BufferGeometry();
    pointsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(coords, 3));
    pointsGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    // Custom circular soft texture for light-canvas points
    const canvasTexture = document.createElement('canvas');
    canvasTexture.width = 32;
    canvasTexture.height = 32;
    const ctx = canvasTexture.getContext('2d');
    const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 15);
    grad.addColorStop(0, 'rgba(30, 41, 59, 0.9)');
    grad.addColorStop(0.5, 'rgba(79, 70, 229, 0.5)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(16, 16, 15, 0, Math.PI * 2);
    ctx.fill();

    const pTexture = new THREE.CanvasTexture(canvasTexture);

    const pointsMaterial = new THREE.PointsMaterial({
      size: 4,
      map: pTexture,
      transparent: true,
      vertexColors: true,
      opacity: 0.65,
      blending: THREE.NormalBlending,
      depthWrite: false
    });

    const pointCloud = new THREE.Points(pointsGeometry, pointsMaterial);
    scene.add(pointCloud);

    // Dynamic Connection Lines (thin, elegant, low-contrast)
    const lineIndices = [];
    const maxDistance = 44;

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
      color: 0x94a3b8,
      transparent: true,
      opacity: 0.32,
      blending: THREE.NormalBlending
    });

    const networkLines = new THREE.LineSegments(linesGeometry, linesMaterial);
    scene.add(networkLines);

    // Subtle pointer parallax
    function onPointerMove(e) {
      const halfX = window.innerWidth / 2;
      const halfY = window.innerHeight / 2;
      mouseX = (e.clientX - halfX) / halfX;
      mouseY = (e.clientY - halfY) / halfY;
      targetRotationY = mouseX * 0.18;
      targetRotationX = mouseY * 0.12;
    }

    window.addEventListener('pointermove', onPointerMove, { passive: true });

    // Responsive resize handler
    function onResize() {
      if (!renderer || !camera || !canvas) return;
      const currentParent = canvas.parentElement;
      const w = currentParent ? currentParent.clientWidth : window.innerWidth;
      const h = currentParent ? Math.max(currentParent.clientHeight, 360) : 420;
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

    // Animation Loop (Slow, graceful, minimal CPU)
    function animate() {
      if (prefersReducedMotion) {
        renderer.render(scene, camera);
        return;
      }

      animationFrameId = requestAnimationFrame(animate);

      if (!isVisible) return;

      // Slow, subtle continuous drift
      scene.rotation.y += 0.0006;
      scene.rotation.x += 0.0002;

      // Smooth dampening towards cursor
      scene.rotation.y += (targetRotationY - scene.rotation.y) * 0.02;
      scene.rotation.x += (targetRotationX - scene.rotation.x) * 0.02;

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
