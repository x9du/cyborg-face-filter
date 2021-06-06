"use strict";

// import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

// Globals:
let THREECAMERA = null, MASKMATERIAL = null, CANVAS = null, THREERENDERER = null;

// Entry point:
function main(){
  // set canvas fullscreen with JeelizResizer.js helper:
  JeelizResizer.size_canvas({
    canvasId: 'matrixCanvas',
    CSSFlipX: true, // This option was previously called isFlipY
    isFullScreen: true,
    callback: start,
    onResize: function(){
      if (THREECAMERA){
        THREECAMERA.aspect = CANVAS.width / CANVAS.height;
        THREECAMERA.updateProjectionMatrix();
      }
      if (MASKMATERIAL){
        MASKMATERIAL.uniforms.resolution.value.set(CANVAS.width, CANVAS.height);
      }
    }
  }); //end size_canvas call
}

// called when the canvas is resized:
function start(){
  // initialise Jeeliz Facefilter:
  JEELIZFACEFILTER.init({
    canvasId: 'matrixCanvas',
    // path of NN_DEFAULT.json:
    NNCPath: './neuralNets/',
    callbackReady: function(errCode, spec){ 
      if (errCode){
        console.log('HEY, THERE IS AN ERROR =', errCode);
        return;
      }
      console.log('JEELIZFACEFILTER WORKS YEAH!');
      init_scene(spec);
    }, //end callbackReady()

    callbackTrack: callbackTrack
  });
} 

function init_scene(spec){
  CANVAS = spec.canvasElement;
  const threeInstances = JeelizThreeHelper.init(spec);
  THREERENDERER = threeInstances.renderer;

  // create a camera with a 20° FoV - obsolete because FoV depend on device:
  //var aspecRatio = spec.canvasElement.width / spec.canvasElement.height;
  //THREECAMERA = new THREE.PerspectiveCamera(20, aspecRatio, 0.1, 100);
  
  // New way to create the camera, try to guess a good FoV:
  THREECAMERA = JeelizThreeHelper.create_camera();

  // face texture
  const video_binary = document.createElement('video');
  video_binary.src = 'assets/binary.mp4';
  video_binary.setAttribute('loop', 'true');
  video_binary.setAttribute('preload', 'true');
  video_binary.setAttribute('autoplay', 'true');
  const faceTexture = new THREE.VideoTexture( video_binary );
  faceTexture.magFilter = THREE.LinearFilter;
  faceTexture.minFilter = THREE.LinearFilter;

  try{ // workaround otherwise chrome do not want to play the video sometimes...
    video_binary.play();
  } catch(e){
  }
  const playVideo = function(){
    video_binary.play();
    window.removeEventListener('mousemove', playVideo);
    window.removeEventListener('touchmove', playVideo);
  }
  window.addEventListener('mousedown', playVideo, false);
  window.addEventListener('touchdown', playVideo, false);

  // background texture
  const bgTexture = new THREE.TextureLoader().load("assets/city.png");
  bgTexture.magFilter = THREE.LinearFilter;
  bgTexture.minFilter = THREE.LinearFilter;
  threeInstances.videoMesh.material.uniforms.samplerVideo.value = bgTexture;

  // face mesh:
  new THREE.BufferGeometryLoader().load('assets/maskMesh.json', function(maskGeometry){
    maskGeometry.computeVertexNormals();
    
    // create the customized material:
    MASKMATERIAL = new THREE.ShaderMaterial({
      vertexShader: "\n\
      varying vec3 vNormalView, vPosition;\n\
      void main(void){\n\
        #include <beginnormal_vertex>\n\
        #include <defaultnormal_vertex>\n\
        #include <begin_vertex>\n\
        #include <project_vertex>\n\
        vNormalView = vec3(viewMatrix*vec4(normalize( transformedNormal ),0.));\n\
        vPosition = position;\n\
      }",

      fragmentShader: "precision lowp float;\n\
      uniform vec2 resolution;\n\
      uniform sampler2D samplerCamera, samplerVideo, samplerFace;\n\
      uniform mat2 videoTransformMat2;\n\
      varying vec3 vNormalView, vPosition;\n\
      \n\
      void main(void){\n\
        // Borders \n\
        // float isNeck=1.-smoothstep(-1.2, -0.85, vPosition.y);\n\
        // float isTangeant=pow(length(vNormalView.xy),2.);\n\
        // float isInsideFace=(1.-isTangeant)*(1.-isNeck);\n\
        \n\
        vec2 uv = gl_FragCoord.xy/resolution;\n\
        vec2 uvCameraCentered = 2.0 * videoTransformMat2 * (uv - 0.5);\n\
        \n\
        // Webcam \n\
        vec3 colorCamera = texture2D(samplerCamera, uvCameraCentered + 0.5).rgb;\n\
        float colorCameraGrey = dot(colorCamera, vec3(0.299, 0.587, 0.114)); // Convert rgb to greyscale\n\
        colorCamera = colorCameraGrey * vec3(0.0, 0.8, 0.8); // Color face differently\n\
        colorCamera += vec3(0.5, 0.5, 0.5) * smoothstep(0.3, 0.6, colorCameraGrey); // White if value reaches threshold of 0.3. Saturates value > 0.6\n\
        \n\
        // Face texture \n\
        vec3 refracted = refract(vec3(0.,0.,-1.), vNormalView, 0.3);\n\
        vec2 uvRefracted = uv + 0.1*refracted.xy;\n\
        // uvRefracted = mix(uv, uvRefracted, smoothstep(0.,1.,isInsideFace)); // Blur borders\n\
        vec3 colorCyborg = texture2D(samplerFace, uvRefracted).rgb;\n\
        \n\
        vec3 finalColor = colorCamera /** isInsideFace*/ + colorCyborg;\n\
        gl_FragColor = vec4(finalColor, 1.); //1 for alpha channel\n\
      }",

      uniforms:{
        samplerCamera: {value: JeelizThreeHelper.get_threeVideoTexture()},
        samplerVideo: {value: bgTexture},
        samplerFace: {value: faceTexture},
        videoTransformMat2: {value: spec.videoTransformMat2},
        resolution: {
          value: new THREE.Vector2(spec.canvasElement.width,
                                   spec.canvasElement.height)}
      }
    });

    const maskMesh = new THREE.Mesh(maskGeometry, MASKMATERIAL);
    maskMesh.position.set(0, 0.3,-0.35);
    threeInstances.faceObject.add(maskMesh);

    JeelizThreeHelper.apply_videoTexture(maskMesh);
  });

  const loader = new THREE.GLTFLoader();
  const fontLoader = new THREE.FontLoader();

  // Materials
  const normalMat = new THREE.MeshNormalMaterial();
  // create the customized material:
  const binaryMat = new THREE.ShaderMaterial({
    vertexShader: "\n\
    void main(void){\n\
      #include <beginnormal_vertex>\n\
      #include <defaultnormal_vertex>\n\
      #include <begin_vertex>\n\
      #include <project_vertex>\n\
    }",

    fragmentShader: "precision lowp float;\n\
    uniform vec2 resolution;\n\
    uniform sampler2D samplerFace;\n\
    uniform mat2 videoTransformMat2;\n\
    \n\
    void main(void){\n\
      vec2 uv = gl_FragCoord.xy/resolution;\n\
      vec2 uvCameraCentered = 2.0 * videoTransformMat2 * (uv - 0.5);\n\
      \n\
      // Webcam \n\
      vec3 colorCamera = vec3(0, 0, 0); // Color face differently\n\
      \n\
      // Face texture \n\
      vec3 colorCyborg = texture2D(samplerFace, uvCameraCentered + 0.5).rgb;\n\
      \n\
      vec3 finalColor = colorCamera + colorCyborg;\n\
      gl_FragColor = vec4(finalColor, 1.); //1 for alpha channel\n\
    }",

    uniforms:{
      samplerFace: {value: faceTexture},
      videoTransformMat2: {value: spec.videoTransformMat2},
      resolution: {
        value: new THREE.Vector2(spec.canvasElement.width,
                                 spec.canvasElement.height)}
    }
  });

  // convert gltf to geometry
  function gltfToGeometry(gltf) {
    let geometry = new THREE.BufferGeometry();
    gltf.scene.traverse( function ( child ) {
      if ( child.isMesh ) {
        // child.material.envMap = envMap;
        geometry = child.geometry;
      }
    });
    return geometry;
  }

  function addMesh(geometry, scale = 1, x = 0, y = 0, z = 0, r1 = 0, r2 = 0, r3 = 0, mat = normalMat) {
      const mesh = new THREE.Mesh(geometry, mat);
  
      mesh.scale.multiplyScalar(scale);
      mesh.position.set(x, y, z);
      mesh.rotation.set(r1, r2, r3);
      mesh.frustumCulled = false;
      mesh.side = THREE.DoubleSide;
  
      threeInstances.faceObject.add(mesh);
  }

  function addCustomMesh(gltfFile, scale = 1, x = 0, y = 0, z = 0, r1 = 0, r2 = 0, r3 = 0, mat = normalMat) {
    loader.load(gltfFile, function ( gltf ) {
      // threeInstances._threeScene.add(gltf.scene);
  
      const mesh = new THREE.Mesh(gltfToGeometry(gltf), mat);
  
      mesh.scale.multiplyScalar(scale);
      mesh.position.set(x, y, z);
      mesh.rotation.set(r1, r2, r3);
      mesh.frustumCulled = false;
      mesh.side = THREE.DoubleSide;
  
      threeInstances.faceObject.add(mesh);
    }, undefined, function ( error ) {
      console.error( error );
    });
  }

  // top left lizard mesh
  addCustomMesh('assets/lizard.gltf', 0.03, 0.8, 1, 0, Math.PI / 2, Math.PI * 3 / 4, 0);
  // bottom right lizard mesh
  addCustomMesh('assets/lizard.gltf', 0.03, -0.8, -0.7, 0, Math.PI / 2, Math.PI * -1 / 4, 0, binaryMat);
  const spotLight = new THREE.SpotLight(0xffffff);
  spotLight.position.set(0, 1, 0);
  threeInstances.faceObject.add(spotLight);
  // top ring
  addMesh(new THREE.TorusGeometry(0.7, 0.03, 16, 50), 1, 0, 0.6, 0, Math.PI / 2, Math.PI * -1 / 12);
  // bottom ring
  addMesh(new THREE.TorusGeometry(1.1, 0.02, 16, 50), 1, 0, -0.5, 0, Math.PI / 2, Math.PI * 1 / 15);
  // hammer and sickle
  loader.load('assets/hammer sickle.gltf', function ( gltf ) {
    gltf.scene.traverse( function ( child ) {
      if (child.isMesh) {
        child.updateMatrix(); // as needed
        addMesh(child.geometry, 0.15, 0, 1.3, 0, Math.PI / 2, Math.PI);
      }
    });
  }, undefined, function ( error ) {
    console.error( error );
  });
  // CYBORG letters
  fontLoader.load('assets/Roboto_Regular.json', function (font) {
    function fontGeometry(str) {
      return new THREE.TextGeometry(str, {
        font: font,
        size: 1,
        height: 0.1,
        curveSegments: 5,
      });
    }

    addMesh(fontGeometry('C'), 0.3, 0.4, 1, 0.6, 0, 0, Math.PI);
    addMesh(fontGeometry('Y'), 0.3, 0.75, 0.2, 0.3, 0, Math.PI);
    addMesh(fontGeometry('B'), 0.3, 0.8, -0.32, 0.8, 0, Math.PI);
    addMesh(fontGeometry('O'), 0.3, 0.45, -0.4, 1.2, 0, 0, Math.PI);
    addMesh(fontGeometry('R'), 0.3, -0.3, -0.45, 0.7, 0, Math.PI);
    addMesh(fontGeometry('G'), 0.3, -0.3, 0.45, 0.7, 0, Math.PI);
  });
  // Random normal spheres
  for (let i = 0; i < 10; i++) {
    let x = Math.random() * 0.5 + 0.5;
    if (Math.floor(x * 10) % 2 == 0) { // if first decimal digit is even
      x *= -1
    }
    let y = Math.random() * 2 + -1;
    let z = Math.random() * 2 + -1;
    let r = Math.random() * 0.08 + 0.02;
    addMesh(new THREE.SphereGeometry(r, 10, 10), 1, x, y, z);
  }
  // Random binary spheres
  for (let i = 0; i < 10; i++) {
    let x = Math.random() * 0.5 + 0.5;
    if (Math.floor(x * 10) % 2 == 0) { // if first decimal digit is even
      x *= -1
    }
    let y = Math.random() * 2 + -1;
    let z = Math.random() * 2 + -1;
    let r = Math.random() * 0.08 + 0.02;
    addMesh(new THREE.SphereGeometry(r, 10, 10), 1, x, y, z, 0, 0, 0, binaryMat);
  }
  // Random normal pyramids near top ring
  for (let i = 0; i < 6; i++) {
    let x = Math.random() * 0.8;
    if (Math.floor(x * 10) % 2 == 0) { // if first decimal digit is even
      x *= -1
    }
    let y = Math.random() * 0.2 + 0.5;
    let z = Math.random() * 0.3 + 0.5;
    let r = Math.random() * 0.06 + 0.02;
    let r1 = Math.random() * Math.PI;
    let r2 = Math.random() * Math.PI;
    let r3 = Math.random() * Math.PI;
    addMesh(new THREE.ConeGeometry(r, r * 2, 4), 1, x, y, z, r1, r2, r3);
  }
  // Random binary pyramids near top ring
  for (let i = 0; i < 6; i++) {
    let x = Math.random() * 0.8;
    if (Math.floor(x * 10) % 2 == 0) { // if first decimal digit is even
      x *= -1
    }
    let y = Math.random() * 0.2 + 0.5;
    let z = Math.random() * 0.3 + 0.5;
    let r = Math.random() * 0.06 + 0.02;
    let r1 = Math.random() * Math.PI;
    let r2 = Math.random() * Math.PI;
    let r3 = Math.random() * Math.PI;
    addMesh(new THREE.ConeGeometry(r, r * 2, 4), 1, x, y, z, r1, r2, r3, binaryMat);
  }
  // Random normal pyramids near bottom ring
  for (let i = 0; i < 10; i++) {
    let x = Math.random() * 1.2;
    if (Math.floor(x * 10) % 2 == 0) { // if first decimal digit is even
      x *= -1
    }
    let y = Math.random() * 0.2 + -0.6;
    let z = Math.random() * 0.3 + 0.9;
    let r = Math.random() * 0.06 + 0.02;
    let r1 = Math.random() * Math.PI;
    let r2 = Math.random() * Math.PI;
    let r3 = Math.random() * Math.PI;
    addMesh(new THREE.ConeGeometry(r, r * 2, 4), 1, x, y, z, r1, r2, r3);
  }
  // Random binary pyramids near bottom ring
  for (let i = 0; i < 10; i++) {
    let x = Math.random() * 1.2;
    if (Math.floor(x * 10) % 2 == 0) { // if first decimal digit is even
      x *= -1
    }
    let y = Math.random() * 0.2 + -0.6;
    let z = Math.random() * 0.3 + 0.9;
    let r = Math.random() * 0.06 + 0.02;
    let r1 = Math.random() * Math.PI;
    let r2 = Math.random() * Math.PI;
    let r3 = Math.random() * Math.PI;
    addMesh(new THREE.ConeGeometry(r, r * 2, 4), 1, x, y, z, r1, r2, r3, binaryMat);
  }
}

function callbackTrack(detectState){
  JeelizThreeHelper.render(detectState, THREECAMERA);
}