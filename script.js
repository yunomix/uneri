const canvas = document.getElementById('glCanvas');
const gl = canvas.getContext('webgl');
const fileInput = document.getElementById('fileInput');
const selectBtn = document.getElementById('selectBtn');
const uploadOverlay = document.getElementById('upload-overlay');
const canvasWrapper = document.querySelector('.canvas-wrapper');

if (!gl) {
    alert('Unable to initialize WebGL. Your browser or machine may not support it.');
}

// Vertex Shader
const vsSource = `
    attribute vec4 aVertexPosition;
    attribute vec2 aTextureCoord;
    varying highp vec2 vTextureCoord;
    void main(void) {
        gl_Position = aVertexPosition;
        vTextureCoord = aTextureCoord;
    }
`;

// Fragment Shader
const fsSource = `
    precision highp float;
    varying highp vec2 vTextureCoord;
    uniform sampler2D uSampler;
    uniform float uTime;
    uniform float uAmplitude;
    uniform float uFrequency;
    uniform float uPhase;
    uniform vec2 uResolution;
    uniform int uHasTexture;
    
    // Interaction Uniforms
    uniform vec2 uTouchLocation;   // Normalized 0-1
    uniform float uTouchStrength;  // 0.0 to 1.0+ (spring can overshoot)

    void main(void) {
        if (uHasTexture == 0) {
            gl_FragColor = vec4(0.9, 0.9, 0.9, 1.0); // Light background placeholder
            return;
        }

        vec2 uv = vTextureCoord;
        
        // --- 1. Touch Bulge Effect ---
        // Calculate distance from current pixel to touch point
        // Aspect ratio correction is important for circular bulge, assuming square canvas for now or simple uv
        float dist = distance(uv, uTouchLocation);
        
        // Bulge Radius
        float radius = 0.3; // 30% of screen
        
        // Calculate bulge amount based on distance
        // Smoothstep for smooth falloff
        float influence = smoothstep(radius, 0.0, dist);
        
        // Direction vector from center of bulge to pixel
        vec2 dir = uv - uTouchLocation;
        
        // Distort UV: Push pixels AWAY from center to zoom in? 
        // To zoom IN (magnify), we actually need to pull UVs TOWARDS the center (read from closer pixels)
        // So we SUBTRACT from UV based on direction
        
        uv -= dir * influence * uTouchStrength * 0.5;

        // --- 2. Wavy Line Effect ---
        
        // Calculate the specific line wave value
        float wave = sin(uv.y * uFrequency + uPhase + uTime);
        
        // Horizontal Shift
        float shift = wave * uAmplitude;
        
        // Line Scaling (Breathing)
        float scaleVal = 1.0 + wave * uAmplitude * 4.0;
        
        // Apply scaling relative to center X (0.5)
        uv.x = (uv.x - 0.5) * scaleVal + 0.5;

        // Apply shift
        uv.x += shift;
        
        // Wrap for goofy effect
        if (uv.x < 0.0 || uv.x > 1.0) uv.x = fract(uv.x);
        if (uv.y < 0.0 || uv.y > 1.0) uv.y = fract(uv.y); // Vertical wrap for bulge pull

        gl_FragColor = texture2D(uSampler, uv);
    }
`;

function initShaderProgram(gl, vsSource, fsSource) {
    const vertexShader = loadShader(gl, gl.VERTEX_SHADER, vsSource);
    const fragmentShader = loadShader(gl, gl.FRAGMENT_SHADER, fsSource);
    const shaderProgram = gl.createProgram();
    gl.attachShader(shaderProgram, vertexShader);
    gl.attachShader(shaderProgram, fragmentShader);
    gl.linkProgram(shaderProgram);

    if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
        console.error('Unable to initialize the shader program: ' + gl.getProgramInfoLog(shaderProgram));
        return null;
    }
    return shaderProgram;
}

function loadShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('An error occurred compiling the shaders: ' + gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

const shaderProgram = initShaderProgram(gl, vsSource, fsSource);

const programInfo = {
    program: shaderProgram,
    attribLocations: {
        vertexPosition: gl.getAttribLocation(shaderProgram, 'aVertexPosition'),
        textureCoord: gl.getAttribLocation(shaderProgram, 'aTextureCoord'),
    },
    uniformLocations: {
        uSampler: gl.getUniformLocation(shaderProgram, 'uSampler'),
        uTime: gl.getUniformLocation(shaderProgram, 'uTime'),
        uAmplitude: gl.getUniformLocation(shaderProgram, 'uAmplitude'),
        uFrequency: gl.getUniformLocation(shaderProgram, 'uFrequency'),
        uPhase: gl.getUniformLocation(shaderProgram, 'uPhase'),
        uResolution: gl.getUniformLocation(shaderProgram, 'uResolution'),
        uHasTexture: gl.getUniformLocation(shaderProgram, 'uHasTexture'),
        uTouchLocation: gl.getUniformLocation(shaderProgram, 'uTouchLocation'),
        uTouchStrength: gl.getUniformLocation(shaderProgram, 'uTouchStrength'),
    },
};

// Buffers
const positionBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
const positions = [
    -1.0, 1.0,
    1.0, 1.0,
    -1.0, -1.0,
    1.0, -1.0,
];
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

const textureCoordBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, textureCoordBuffer);
const textureCoordinates = [
    0.0, 0.0,
    1.0, 0.0,
    0.0, 1.0,
    1.0, 1.0,
];
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(textureCoordinates), gl.STATIC_DRAW);

// Texture
const texture = gl.createTexture();
let hasUploadedTexture = false;

function loadTexture(url) {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); // Keep false
    const level = 0;
    const internalFormat = gl.RGBA;
    const width = 1;
    const height = 1;
    const border = 0;
    const srcFormat = gl.RGBA;
    const srcType = gl.UNSIGNED_BYTE;
    const pixel = new Uint8Array([200, 200, 200, 255]);
    gl.texImage2D(gl.TEXTURE_2D, level, internalFormat, width, height, border, srcFormat, srcType, pixel);

    const image = new Image();
    image.onload = function () {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, level, internalFormat, srcFormat, srcType, image);

        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

        hasUploadedTexture = true;
        uploadOverlay.style.opacity = '0'; // Fade out
        setTimeout(() => {
            uploadOverlay.style.display = 'none';
        }, 300);
        resizeCanvas();
    };
    image.src = url;
}

// Button Interaction
selectBtn.addEventListener('click', () => {
    fileInput.click();
});

// Canvas Drag & Drop Image
canvasWrapper.addEventListener('dragover', (e) => {
    e.preventDefault();
    canvasWrapper.style.transform = 'scale(1.02)';
});
canvasWrapper.addEventListener('dragleave', (e) => {
    e.preventDefault();
    canvasWrapper.style.transform = 'scale(1.0)';
});
canvasWrapper.addEventListener('drop', (e) => {
    e.preventDefault();
    canvasWrapper.style.transform = 'scale(1.0)';
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
        const url = URL.createObjectURL(file);
        loadTexture(url);
    }
});

fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        const url = URL.createObjectURL(file);
        loadTexture(url);
    }
});

// Resize
function resizeCanvas() {
    const displayWidth = canvas.clientWidth;
    const displayHeight = canvas.clientHeight;
    if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
        canvas.width = displayWidth;
        canvas.height = displayHeight;
    }
}

// Animation Variables
let startTime = 0;
let baseFreq = 10.0;
let baseAmp = 0.08; // Increased from 0.05

// Physics Variables for Bulge
let isTouching = false;
let touchX = 0.5;
let touchY = 0.5;

// Spring State for Strength
let springPosition = 0.0; // Corresponds to uTouchStrength
let springVelocity = 0.0;
let targetPosition = 0.0;

// Interaction Event Listeners
function updateTouch(x, y) {
    const rect = canvas.getBoundingClientRect();
    // Normalize to 0-1 and flip Y? No UV 0,0 is usually Top Left in some contexts or Bottom Left in GL.
    // In WebGL texture coords: (0,0) is usually Bottom-Left if not flipped.
    // But our vertex buffer matches screen coords (-1 to 1). Texture coords (0,1).
    // Let's assume standard intuitive X (left->right) Y (top->bottom) for now and adjust if needed.
    // Wait, if UNPACK_FLIP_Y is false, image top is at V=0 or V=1?
    // Usually images are loaded top-down. IF FlipY is false, 0,0 in memory is top-left.
    // In default GL UV, (0,0) is bottom-left. 
    // Let's rely on observation.

    touchX = (x - rect.left) / rect.width;
    touchY = (y - rect.top) / rect.height;

    // UV (0,0) is Top-Left in our current setup (Positions -1,1 -> UV 0,0)
    // And UNPACK_FLIP_Y is false, so Image Top is at Texture 0.
    // So DOM Y (0 at top) matches Texture Y (0 at top).
    // No inversion needed.
}

function handleStart(x, y) {
    isTouching = true;
    updateTouch(x, y);
}

function handleMove(x, y) {
    if (isTouching) {
        updateTouch(x, y);
    }
}

function handleEnd() {
    isTouching = false;
}

// Mouse Events
canvasWrapper.addEventListener('mousedown', (e) => handleStart(e.clientX, e.clientY));
window.addEventListener('mousemove', (e) => handleMove(e.clientX, e.clientY));
window.addEventListener('mouseup', handleEnd);

// Touch Events
canvasWrapper.addEventListener('touchstart', (e) => {
    e.preventDefault();
    handleStart(e.touches[0].clientX, e.touches[0].clientY);
}, { passive: false });
window.addEventListener('touchmove', (e) => {
    if (isTouching) {
        //    e.preventDefault(); 
    }
    handleMove(e.touches[0].clientX, e.touches[0].clientY);
}, { passive: false });
window.addEventListener('touchend', handleEnd);


// Render Loop
function render(now) {
    now *= 0.001; // convert to seconds
    if (startTime === 0) startTime = now;
    const time = now - startTime;

    resizeCanvas();
    gl.viewport(0, 0, canvas.width, canvas.height);

    gl.clearColor(1.0, 1.0, 1.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(programInfo.program);

    // Bind Buffers
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.vertexAttribPointer(programInfo.attribLocations.vertexPosition, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(programInfo.attribLocations.vertexPosition);

    gl.bindBuffer(gl.ARRAY_BUFFER, textureCoordBuffer);
    gl.vertexAttribPointer(programInfo.attribLocations.textureCoord, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(programInfo.attribLocations.textureCoord);

    // Bind Texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(programInfo.uniformLocations.uSampler, 0);

    // --- Spring Physics Update ---
    // User Requirement:
    // 1. "Nume-tto" (Slimy/Viscous) increase when dragged -> High Damping, Overdamped
    // 2. "Poyoon" (Springy/Boing) decrease/bounce when released -> Low Damping, Underdamped

    if (isTouching) {
        targetPosition = 2.0; // Increased from 1.0 for stronger bulge
        // Overdamped parameters
        // F = -k * x - c * v
        const k = 50.0; // Stiffness
        const c = 20.0;  // Damping (high)
        const dt = 0.016; // Fixed timestep approx

        const force = k * (targetPosition - springPosition) - c * springVelocity;
        springVelocity += force * dt;
        springPosition += springVelocity * dt;

    } else {
        targetPosition = 0.0;
        // Underdamped parameters
        const k = 150.0; // High stiffness for bounce
        const c = 4.0;   // Low damping for oscillations
        const dt = 0.016;

        const force = k * (targetPosition - springPosition) - c * springVelocity;
        springVelocity += force * dt;
        springPosition += springVelocity * dt;
    }

    // Clamp slightly to avoid chaos but allow overshoot for bounce
    // Just ensure it doesn't explode
    if (Math.abs(springPosition) > 10.0) { springPosition = 0; springVelocity = 0; }

    // Auto Animation (Background)
    let autoOscAmp = Math.sin(time * 0.5) * 0.05; // Increased oscillation range (was 0.03)
    let autoOscFreq = Math.sin(time * 0.3) * 5.0;

    let finalAmp = baseAmp + autoOscAmp; // baseAmp will be increased below
    let finalFreq = baseFreq + autoOscFreq;
    let finalPhase = time * 2.0;

    gl.uniform1f(programInfo.uniformLocations.uTime, time);
    gl.uniform1f(programInfo.uniformLocations.uAmplitude, finalAmp);
    gl.uniform1f(programInfo.uniformLocations.uFrequency, finalFreq);
    gl.uniform1f(programInfo.uniformLocations.uPhase, finalPhase);
    gl.uniform2f(programInfo.uniformLocations.uResolution, canvas.width, canvas.height);
    gl.uniform1i(programInfo.uniformLocations.uHasTexture, hasUploadedTexture ? 1 : 0);

    gl.uniform2f(programInfo.uniformLocations.uTouchLocation, touchX, touchY);
    gl.uniform1f(programInfo.uniformLocations.uTouchStrength, springPosition);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    requestAnimationFrame(render);
}

requestAnimationFrame(render);
