const JeelizThreeHelper = (function () {
  const _settings = {
    rotationOffsetX: 0.0,
    pivotOffsetYZ: [0.2, 0.6],
    
    detectionThreshold: 0.8,
    detectionHysteresis: 0.02,
    
    cameraMinVideoDimFov: 35,
    isDebugPivotPoint: false
  };
  
  let _threeRenderer = null,
      _threeScene = null,
      _threeVideoMesh = null,
      _threeVideoTexture = null;
      
  let _maxFaces = -1,
      _isMultiFaces = false,
      _detectCallback = null,
      _isVideoTextureReady = false,
      _isSeparateThreejsCanvas = false,
      _faceFilterCv = null,
      _videoElement = null,
      _isDetected = false,
      _scaleW = 1,
      _canvasAspectRatio = -1;
      
  const _threeCompositeObjects = [],
        _threePivotedObjects = [];
  
  let _gl = null,
      _glVideoTexture = null,
      _glShpCopy = null;

  function destroy() {
    _isVideoTextureReady = false;
    _threeCompositeObjects.splice(0);
    _threePivotedObjects.splice(0);
    if (_threeVideoTexture) {
      _threeVideoTexture.dispose();
      _threeVideoTexture = null;
    }
  }

  function create_threeCompositeObjects() {
    for (let i = 0; i < _maxFaces; ++i) {
      const threeCompositeObject = new THREE.Object3D();
      threeCompositeObject.frustumCulled = false;
      threeCompositeObject.visible = false;
      const threeCompositeObjectPIVOTED = new THREE.Object3D();
      threeCompositeObjectPIVOTED.frustumCulled = false;
      threeCompositeObject.add(threeCompositeObjectPIVOTED);
      _threeCompositeObjects.push(threeCompositeObject);
      _threePivotedObjects.push(threeCompositeObjectPIVOTED);
      _threeScene.add(threeCompositeObject);
      if (_settings.isDebugPivotPoint) {
        const pivotCubeMesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshNormalMaterial({side: THREE.DoubleSide, depthTest: false }));
        pivotCubeMesh.position.copy(threeCompositeObjectPIVOTED.position);
        threeCompositeObject.add(pivotCubeMesh);
        window.pivot = pivotCubeMesh;
        console.log('DEBUG in JeelizThreeHelper: set the position of <pivot> in the console and report the value into JeelizThreejsHelper.js for _settings.pivotOffsetYZ');
      }
    }
  }

  function create_videoScreen() {
    const videoScreenVertexShaderSource = "attribute vec2 position;\n\
        varying vec2 vUV;\n\
        void main(void){\n\
          gl_Position = vec4(position, 0., 1.);\n\
          vUV = 0.5 + 0.5 * position;\n\
        }";
    const videoScreenFragmentShaderSource = "precision lowp float;\n\
        uniform sampler2D samplerVideo;\n\
        varying vec2 vUV;\n\
        void main(void){\n\
          gl_FragColor = texture2D(samplerVideo, vUV);\n\
        }";
    
    if (_isSeparateThreejsCanvas) {
      const compile_shader = function (source, type, typeString) {
        const shader = _gl.createShader(type);
        _gl.shaderSource(shader, source);
        _gl.compileShader(shader);
        if (!_gl.getShaderParameter(shader, _gl.COMPILE_STATUS)) {
          alert("ERROR IN " + typeString + " SHADER: " + _gl.getShaderInfoLog(shader));
          return false;
        }
        return shader;
      };
      
      const shader_vertex = compile_shader(videoScreenVertexShaderSource, _gl.VERTEX_SHADER, 'VERTEX');
      const shader_fragment = compile_shader(videoScreenFragmentShaderSource, _gl.FRAGMENT_SHADER, 'FRAGMENT');
      
      _glShpCopy = _gl.createProgram();
      _gl.attachShader(_glShpCopy, shader_vertex);
      _gl.attachShader(_glShpCopy, shader_fragment);

      _gl.linkProgram(_glShpCopy);
      const samplerVideo = _gl.getUniformLocation(_glShpCopy, 'samplerVideo');
      
      return;
    }

    _threeVideoTexture = new THREE.DataTexture(new Uint8Array([255, 0, 0]), 1, 1, THREE.RGBFormat);
    _threeVideoTexture.needsUpdate = true;

    const videoMaterial = new THREE.RawShaderMaterial({
      depthWrite: false,
      depthTest: false,
      vertexShader: videoScreenVertexShaderSource,
      fragmentShader: videoScreenFragmentShaderSource,
      uniforms: {
        samplerVideo: { value: _threeVideoTexture }
      }
    });
    
    const videoGeometry = new THREE.BufferGeometry()
    const videoScreenCorners = new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]);
    videoGeometry.addAttribute('position', new THREE.BufferAttribute(videoScreenCorners, 2));
    videoGeometry.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));
    _threeVideoMesh = new THREE.Mesh(videoGeometry, videoMaterial);
    that.apply_videoTexture(_threeVideoMesh);
    _threeVideoMesh.renderOrder = -1000;
    _threeVideoMesh.frustumCulled = false;
    _threeScene.add(_threeVideoMesh);
  }

  function detect(detectState) {
    _threeCompositeObjects.forEach(function (threeCompositeObject, i) {
      _isDetected = threeCompositeObject.visible;
      const ds = detectState[i];
      if (_isDetected && ds.detected < _settings.detectionThreshold - _settings.detectionHysteresis) {
        if (_detectCallback) _detectCallback(i, false);
        threeCompositeObject.visible = false;
      } else if (!_isDetected && ds.detected > _settings.detectionThreshold + _settings.detectionHysteresis) {
        if (_detectCallback) _detectCallback(i, true);
        threeCompositeObject.visible = true;
      }
    });
  }

  function update_poses(ds, threeCamera) {
    const halfTanFOVX = Math.tan(threeCamera.aspect * threeCamera.fov * Math.PI / 360);
    
    _threeCompositeObjects.forEach(function (threeCompositeObject, i) {
      if (!threeCompositeObject.visible) return;
      const detectState = ds[i];
      
      const cz = Math.cos(detectState.rz), sz = Math.sin(detectState.rz);
      
      const W = detectState.s * _scaleW;
      
      const DFront = 1 / (2 * W * halfTanFOVX);
      
      const D = DFront + 0.5;
      
      const xv = detectState.x * _scaleW;
      const yv = detectState.y * _scaleW;
      
      const z = -D;
      const x = xv * D * halfTanFOVX;
      const y = yv * D * halfTanFOVX / _canvasAspectRatio;
      
      _threePivotedObjects[i].position.set(-sz * _settings.pivotOffsetYZ[0], -cz * _settings.pivotOffsetYZ[0], -_settings.pivotOffsetYZ[1]);
      
      threeCompositeObject.position.set(x, y + _settings.pivotOffsetYZ[0], z + _settings.pivotOffsetYZ[1]);
      
      threeCompositeObject.rotation.set(detectState.rx + _settings.rotationOffsetX, detectState.ry, detectState.rz, "ZYX");
    });
  }

  const that = {
    init: function (spec, detectCallback) {
      destroy();
      
      _maxFaces = spec.maxFacesDetected;
      _glVideoTexture = spec.videoTexture;
      _gl = spec.GL;
      _faceFilterCv = spec.canvasElement;
      _isMultiFaces = (_maxFaces > 1);
      _videoElement = spec.videoElement;
      let threejsCanvas = null;
      if (spec.threejsCanvasId) {
        _isSeparateThreejsCanvas = true;
        threejsCanvas = document.getElementById(spec.threejsCanvasId);
        threejsCanvas.setAttribute('width', _faceFilterCv.width);
        threejsCanvas.setAttribute('height', _faceFilterCv.height);
      } else {
        threejsCanvas = _faceFilterCv;
      }
      
      if (typeof(detectCallback) !== 'undefined') {
        _detectCallback = detectCallback;
      }

      _threeRenderer = new THREE.WebGLRenderer({
        context: (_isSeparateThreejsCanvas) ? null : _gl,
        canvas: threejsCanvas,
        alpha: (_isSeparateThreejsCanvas || spec.alpha) ? true : false
      });

      _threeScene = new THREE.Scene();

      create_threeCompositeObjects();
      create_videoScreen();

      window.addEventListener('orientationchange', function() {
        setTimeout(JEEFACEFILTERAPI.resize, 1000);
      }, false);

      const returnedDict = {
        videoMesh: _threeVideoMesh,
        renderer: _threeRenderer,
        scene: _threeScene
      };
      if (_isMultiFaces) {
        returnedDict.faceObjects = _threePivotedObjects;
      } else {
        returnedDict.faceObject = _threePivotedObjects[0];
      }
      return returnedDict;
    },
    
    detect: function(detectState) {
      const ds = (_isMultiFaces) ? detectState : [detectState];
      detect(ds);
    }, get_isDetected: function() {
      return _isDetected;
    }, render: function(detectState, threeCamera) {
      const ds = (_isMultiFaces) ? detectState : [detectState];
      detect(ds);
      update_poses(ds, threeCamera);
      if (_isSeparateThreejsCanvas) {
        _gl.viewport(0, 0, _faceFilterCv.width, _faceFilterCv.height);
        _gl.useProgram(_glShpCopy);
        _gl.activeTexture(_gl.TEXTURE0);
        _gl.bindTexture(_gl.TEXTURE_2D, _glVideoTexture);
        _gl.drawElements(_gl.TRIANGLES, 3, _gl.UNSIGNED_SHORT, 0);
      } else {
        _threeRenderer.state.reset();
      }
      _threeRenderer.render(_threeScene, threeCamera);
    },
  
    sortFaces: function(bufferGeometry, axis, isInv) {
      const axisOffset = {
        X: 0,
        Y: 1,
        Z: 2
      } [axis.toUpperCase()];
      const sortWay = (isInv) ? -1 : 1;
      const nFaces = bufferGeometry.index.count / 3;
      const faces = new Array(nFaces);
      for (let i = 0; i < nFaces; ++i) {
        faces[i] = [bufferGeometry.index.array[3 * i], bufferGeometry.index.array[3 * i + 1], bufferGeometry.index.array[3 * i + 2]];
      }
      const aPos = bufferGeometry.attributes.position.array;
      const centroids = faces.map(function(face, faceIndex) {
        return [(aPos[3 * face[0]] + aPos[3 * face[1]] + aPos[3 * face[2]]) / 3, (aPos[3 * face[0] + 1] + aPos[3 * face[1] + 1] + aPos[3 * face[2] + 1]) / 3, (aPos[3 * face[0] + 2] + aPos[3 * face[1] + 2] + aPos[3 * face[2] + 2]) / 3, face];
      });
      centroids.sort(function(ca, cb) {
        return (ca[axisOffset] - cb[axisOffset]) * sortWay;
      });
      centroids.forEach(function(centroid, centroidIndex) {
        const face = centroid[3];
        bufferGeometry.index.array[3 * centroidIndex] = face[0];
        bufferGeometry.index.array[3 * centroidIndex + 1] = face[1];
        bufferGeometry.index.array[3 * centroidIndex + 2] = face[2];
      });
    },
  
    get_threeVideoTexture: function() {
      return _threeVideoTexture;
    }, apply_videoTexture: function(threeMesh) {
      if (_isVideoTextureReady) {
        return;
      }
      threeMesh.onAfterRender = function() {
        try {
          _threeRenderer.properties.update(_threeVideoTexture, '__webglTexture', _glVideoTexture);
          _threeVideoTexture.magFilter = THREE.LinearFilter;
          _threeVideoTexture.minFilter = THREE.LinearFilter;
          _isVideoTextureReady = true;
        } catch (e) {
          console.log('WARNING in JeelizThreeHelper: the glVideoTexture is not fully initialized');
        }
        delete(threeMesh.onAfterRender);
      };
    },
  
    create_threejsOccluder: function(occluderURL, callback) {
      const occluderMesh = new THREE.Mesh();
      new THREE.BufferGeometryLoader().load(occluderURL, function(occluderGeometry) {
        const mat = new THREE.ShaderMaterial({
          vertexShader: THREE.ShaderLib.basic.vertexShader,
          fragmentShader: "precision lowp float;\n void main(void){\n gl_FragColor=vec4(1.,0.,0.,1.);\n }",
          uniforms: THREE.ShaderLib.basic.uniforms,
          colorWrite: false
        });
        occluderMesh.renderOrder = -1;
        occluderMesh.material = mat;
        occluderMesh.geometry = occluderGeometry;
        if (typeof(callback) !== 'undefined' && callback) callback(occluderMesh);
      });
      return occluderMesh;
    },
    
    set_pivotOffsetYZ: function(pivotOffset) {
      _settings.pivotOffsetYZ = pivotOffset;
    },
    
    create_camera: function(zNear, zFar) {
      const threeCamera = new THREE.PerspectiveCamera(1, 1, (zNear) ? zNear : 0.1, (zFar) ? zFar : 100);
      that.update_camera(threeCamera);
      return threeCamera;
    },
    
    update_camera: function(threeCamera) {
      const canvasElement = _threeRenderer.domElement;
      const cvw = canvasElement.width;
      const cvh = canvasElement.height;
      _canvasAspectRatio = cvw / cvh;
      const vw = _videoElement.videoWidth;
      const vh = _videoElement.videoHeight;
      const videoAspectRatio = vw / vh;
      const fovFactor = (vh > vw) ? (1.0 / videoAspectRatio) : 1.0;
      const fov = _settings.cameraMinVideoDimFov * fovFactor;
      console.log('INFO in JeelizThreejsHelper - update_camera(): Estimated vertical video FoV is', fov);
      let scale = 1.0;
      if (_canvasAspectRatio > videoAspectRatio) {
        scale = cvw / vw;
      } else {
        scale = cvh / vh;
      }
      const cvws = vw * scale,
        cvhs = vh * scale;
      const offsetX = (cvws - cvw) / 2.0;
      const offsetY = (cvhs - cvh) / 2.0;
      _scaleW = cvw / cvws;
      threeCamera.aspect = _canvasAspectRatio;
      threeCamera.fov = fov;
      console.log('INFO in JeelizThreejsHelper.update_camera(): camera vertical estimated FoV is', fov, 'deg');
      threeCamera.setViewOffset(cvws, cvhs, offsetX, offsetY, cvw, cvh);
      threeCamera.updateProjectionMatrix();
      _threeRenderer.setSize(cvw, cvh, false);
      _threeRenderer.setViewport(0, 0, cvw, cvh);
    },
  
    resize: function(w, h, threeCamera) {
      _threeRenderer.domElement.width = w;
      _threeRenderer.domElement.height = h;
      JEEFACEFILTERAPI.resize();
      if (threeCamera) {
        that.update_camera(threeCamera);
      }
    }
  }
  return that;
})();

try {
  module.exports = JeelizThreeHelper;
} catch (e) {
  console.log('JeelizThreeHelper ES6 Module not exported');
  window.JeelizThreeHelper = JeelizThreeHelper;
}