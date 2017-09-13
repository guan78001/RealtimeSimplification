function ownCubic(x){return x*x*x;}

function setStatic(static_url){static = static_url;}

function setXYZ(array,index,x,y,z){
    var i = index*3;
    array[i++]=x;
    array[i++]=y;
    array[i]=z;
}

if (!Array.prototype.last){
    Array.prototype.last = function(){
        return this[this.length - 1];
    };
};

function rotateAroundObjectAxis(object, axis, radians) {
    rotObjectMatrix = new THREE.Matrix4();
    rotObjectMatrix.makeRotationAxis(axis.normalize(), radians);
    object.matrix.multiply(rotObjectMatrix);
    object.rotation.setEulerFromRotationMatrix(object.matrix);
}

function look(attribute,index,value){
    return (
            attribute[index] == value && 
            attribute[index+1] == value && 
            attribute[index+2] == value
            )
}

function MaxInVector(Vector){
    var x = Vector.x;
    var y = Vector.y;
    var z = Vector.z;

    return ((x>y)?((x>z)?x:z):(y>z)?y:z);
}

function MinInVector(Vector){
    var x = Vector.x;
    var y = Vector.y;
    var z = Vector.z;

    return ((x<y)?((x<z)?x:z):(y<z)?y:z);
}

class WebGl{
    constructor(canvas,Dim,RTDim) {
        //Variable de debuggeo, si esta en true realizara las operaciones
        //utilizando el cpu en vez del gpu para facilitar la validación
        this.DEBUG = false; //Esta en desuso or los momentos.

        this.static = './static/';
        this.Dim = Dim;
        this.RTDim = RTDim;
        this.scene = new THREE.Scene();
        this.sceneRTT = new THREE.Scene();
        this.canvas = document.getElementById(canvas);
        this.WIDTH = window.innerWidth/2;
        this.HEIGHT = window.innerHeight;
        this.canvas.width = this.WIDTH;
        this.canvas.height = this.HEIGHT;
        this.renderer = new THREE.WebGLRenderer({
            antialias:true,
            canvas : this.canvas
        });
        this.renderer.setSize(this.WIDTH, this.HEIGHT);
        this.renderer.autoClear = false;
        this.cam = new THREE.PerspectiveCamera( 45, 
                                                this.WIDTH / this.HEIGHT, 
                                                0.1, 
                                                20000
                                            );
        this.cam.position.set(3,2,3);
        this.cam.up = new THREE.Vector3(0,1,0)
        this.camRTT = new THREE.OrthographicCamera( -1,1, 1, -1, 0.1,1);
        this.camRTT.position.set(0,0,0);
        this.renderer.shadowMap.enabled = true;
        this.controls = new THREE.OrbitControls(this.cam, this.renderer.domElement);
        this.controls.userPanSpeed = 0.15;
        this.stats = new Stats();
        this.stats.domElement.style.position = 'absolute';
        this.stats.domElement.style.top = '0px';
        this.textures = [];
        this.PassOneResult = [];
        this.Simplify = false;
        this.meshID = 0;
        this.setShaders();
        this.Cargarscenerio(this.scene);
        document.body.appendChild( this.stats.domElement );
        window.addEventListener( 'resize', this.resize.bind(this), false );
        this.initGL();
        this.initTextureFramebuffer();
        this.animate();
    }

    setShaders(){
        this.vertexShader = `
            #define M_PI 3.1415926535897932384626433832795
            varying vec3 pos;
            void main(){
                pos = position;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position , 1.0);
            }
        `;
        
        this.fragmentShader = `
            varying vec3 pos;
            void main()
            {
                gl_FragColor = vec4(pos, 1.0);
            }
        `;
        
        this.matVertShader = `
            varying vec3 vWorldPosition;

            void main() {

                vec4 worldPosition = modelMatrix * vec4( position, 1.0 );
                vWorldPosition = worldPosition.xyz;

                gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

            }
        `;
        
        this.matFragShader = `
            uniform vec3 topColor;
            uniform vec3 bottomColor;
            uniform float offset;
            uniform float exponent;

            varying vec3 vWorldPosition;

            void main() {

                float h = normalize( vWorldPosition + offset ).y;
                gl_FragColor =  vec4(
                    mix(
                        bottomColor,
                        topColor,
                        max(pow(max(h,0.0),exponent),0.0)
                    ),
                    1.0
                );
            }        
        `;
        
        this.vertexPass1 = `
            precision highp float;
            precision highp int;

            uniform vec3 max; //Vertex with the Max values
            uniform vec3 min; //Vertex with the Min values
            uniform float Dim; //Number of Cells for axis
            uniform float RTDim; //Dimension of the Frambuffer/Texture/Viewport
            uniform int NoB; //Number of Buffers that can handle the video card
            attribute vec3 VA;
            attribute vec3 VB;
            attribute vec3 VC;
            attribute float VDraw;
            attribute vec3 VertPos;

            varying float Result[16];
            varying vec3 DebugA;
            varying vec3 DebugB;
            varying vec3 DebugC;

            mat4 vectorTranspose(vec4 A,vec4 B) {
                mat4 matrix;
                matrix[0] = vec4(A.x*B.x, A.y*B.x, A.z*B.x, A.w*B.x);
                matrix[1] = vec4(A.x*B.y, A.y*B.y, A.z*B.y, A.w*B.y);
                matrix[2] = vec4(A.x*B.z, A.y*B.z, A.z*B.z, A.w*B.z);    
                matrix[3] = vec4(A.x*B.w, A.y*B.w, A.z*B.w, A.w*B.w);    
                return matrix;
            }

            vec3 resizeVec3(vec3 f, vec3 max, vec3 min){
                vec3 result;
                result.x = ((f.x-min.x)/(max.x - min.x))+1.0;
                result.y = ((f.y-min.y)/(max.y - min.y))+1.0;
                result.z = ((f.z-min.z)/(max.z - min.z))+1.0;
                return result;
            }

            void main(void) {
                vec3 pos;
                //vec3 nVA = (VA/3.0)+1.0;
                //vec3 nVB = (VB/3.0)+1.0;
                //vec3 nVC = (VC/3.0)+1.0;
                //vec3 nVertPos = resizeVec3(VC, max, min);


                //First i take the vertex from the min-max range to the 0-Dim range
                vec3 CellIndex = floor((VertPos - min)*Dim/(max - min));

                //vec3 falseMin = vec3(1.0,1.0,1.0);
                //vec3 falseMax = vec3(2.0,2.0,2.0);
                //vec3 falseVertPos = (VertPos/3.0)+1.0;
                //vec3 CellIndex2 = floor((falseVertPos - falseMin)*(Dim-1.0)/(falseMax - falseMin));
                //DebugA = falseVertPos;
                //DebugB = CellIndex2;
                //DebugC = CellIndex;
                //CellIndex = CellIndex2;

                if(CellIndex.x == Dim)CellIndex.x--;
                if(CellIndex.y == Dim)CellIndex.y--;
                if(CellIndex.z == Dim)CellIndex.z--;


                //Make the 3D index a 1D index

                float temp = CellIndex.x + CellIndex.y * Dim + CellIndex.z*Dim*Dim ;


                //Make the 1D index a 2D index
                pos.y = floor(temp/RTDim);
                pos.x = temp - (pos.y * RTDim);
                pos.z = 1.0;
                // it seems that the vertex with index 0 are begin culled

                pos.x = pos.x +1.0;
                pos.y = pos.y +1.0;

                //Take from the 0-RTDim range to the -1 - 1 Range
                pos.x = ((pos.x / RTDim)*2.0) - 1.0;
                pos.y = ((pos.y / RTDim)*2.0) - 1.0;


                vec4 n =    vec4(   cross(VA,VB)+cross(VB,VC)+cross(VC,VA),
                                    -dot(VA,cross(VB,VC))
                            );


                //vec4 n =    vec4(   cross(nVA,nVB)+cross(nVB,nVC)+cross(nVC,nVA),
                //                    -dot(nVA,cross(nVB,nVC))
                //            );

                mat4 cuadraticError = vectorTranspose(n,n);

                Result[0]= cuadraticError[0][0];
                Result[1]= cuadraticError[1][0];
                Result[2]= cuadraticError[2][0];
                Result[3]= cuadraticError[3][0];
                Result[4]= cuadraticError[1][1];
                Result[5]= cuadraticError[2][1];
                Result[6]= cuadraticError[3][1];
                Result[7]= cuadraticError[2][2];
                Result[8]= cuadraticError[3][2];
                Result[9]= cuadraticError[3][3];
                Result[10]= VertPos.x;
                Result[11]= VertPos.y;
                Result[12]= VertPos.z;
                Result[13]= 1.0;

                //if(VDraw == 0.0){
                //    pos = vec3(-100.0,-100.0,-100.0);
                //}

                gl_Position = vec4(pos, 1.0);
                gl_PointSize = 1.0;      
            }
        `;
        
        this.fragmentPass1 = `
            #extension GL_EXT_draw_buffers : enable
            precision highp float;
            precision highp int;
            uniform int NoB;

            varying float Result[16];
            varying vec3 DebugA;
            varying vec3 DebugB;
            varying vec3 DebugC;

            void main(void) {
                //gl_FragData[0] = vec4(1.0,1.0,1.0,1.0);
                //gl_FragData[1] = vec4(1.0,1.0,1.0,1.0);
                //gl_FragData[2] = vec4(1.0,1.0,1.0,1.0);

                //gl_FragData[0] = vec4(DebugA,1.0);
                //gl_FragData[1] = vec4(DebugB,1.0);
                //gl_FragData[2] = vec4(DebugC,1.0);
                
                gl_FragData[0] = vec4(Result[0],Result[1],Result[2],Result[3]);
                gl_FragData[1] = vec4(Result[4],Result[5],Result[6],Result[7]);
                gl_FragData[2] = vec4(Result[8],Result[9],0.0,1.0);
                gl_FragData[3] = vec4(Result[10],Result[11],Result[12],1.0);
                //gl_FragData[3] = vec4(0.0,0.0,0.0,1.0);
            }      
        `;

        this.vertexPass2 = `
            #define M_PI 3.1415926535897932384626433832795
            uniform sampler2D quadricError[4];
            uniform vec3 CellWidth;
            attribute vec3 position;


            void main(){
                gl_Position = vec4(position , 1.0);
            }
        `;
        
        this.fragmentPass2 = `
            #extension GL_EXT_draw_buffers : enable
            precision highp float;
            precision highp int;
            uniform float RTDim;

            uniform sampler2D quadricError[4];
            uniform vec3 CellWidth;

            float determinant(mat3 m) {
                return m[0][0] * (m[2][2]*m[1][1] - m[1][2]*m[2][1])
                    + m[0][1] * (m[1][2]*m[2][0] - m[2][2]*m[1][0])
                    + m[0][2] * (m[2][1]*m[1][0] - m[1][1]*m[2][0]);
            }

            mat3 inverse(mat3 m) {
                float a00 = m[0][0], a01 = m[0][1], a02 = m[0][2];
                float a10 = m[1][0], a11 = m[1][1], a12 = m[1][2];
                float a20 = m[2][0], a21 = m[2][1], a22 = m[2][2];
                
                float b01 = a22 * a11 - a12 * a21;
                float b11 = -a22 * a10 + a12 * a20;
                float b21 = a21 * a10 - a11 * a20;

                float det = a00 * b01 + a01 * b11 + a02 * b21;

                return mat3(b01, (-a22 * a01 + a02 * a21), (a12 * a01 - a02 * a11),
                          b11, (a22 * a00 - a02 * a20), (-a12 * a00 + a02 * a10),
                          b21, (-a21 * a00 + a01 * a20), (a11 * a00 - a01 * a10)) / det;
            }

            void main(void) {
                vec2 xy = gl_FragCoord.xy / RTDim;
                vec4 ForthText = texture2D( quadricError[3], xy);
                float NumberFaces = ForthText.w;

                vec4 FirstText = texture2D( quadricError[0], xy);
                vec4 SecondText = texture2D( quadricError[1], xy);
                vec4 ThirdText = texture2D( quadricError[2], xy);
                mat4 cuadraticError;
                vec3 x;

                cuadraticError[0][0] = FirstText.x;
                cuadraticError[1][0] = FirstText.y;
                cuadraticError[2][0] = FirstText.z;
                cuadraticError[3][0] = FirstText.w;

                cuadraticError[0][1] = FirstText.y;
                cuadraticError[0][2] = FirstText.z;
                cuadraticError[0][3] = FirstText.w;

                cuadraticError[1][1] = SecondText.x;
                cuadraticError[2][1] = SecondText.y;
                cuadraticError[3][1] = SecondText.z;

                cuadraticError[1][2] = SecondText.y;
                cuadraticError[1][3] = SecondText.z;

                cuadraticError[2][2] = SecondText.w;

                cuadraticError[3][2] = ThirdText.x;
                cuadraticError[2][3] = ThirdText.x;

                cuadraticError[3][3] = ThirdText.y;    

                mat3 Errorm3 = mat3(cuadraticError);

                float det = determinant(Errorm3);

                mat3 A = inverse(Errorm3);

                vec3 b = cuadraticError[3].xyz;

                x = A * b;

                x = normalize(x);

                x = x * CellWidth*0.1;

                vec3 result;

                if(ForthText.w != 0.0){
                    result = (ForthText.xyz/ForthText.w);
                }else{
                    result = ForthText.xyz;
                }
                //result += x;


                gl_FragData[0] = vec4(result,1.0);                               
            }   
        `;

        this.vertexPass3 = `
            precision highp float;
            precision highp int;

            uniform vec3 max; //Vertex with the Max values
            uniform vec3 min; //Vertex with the Min values
            uniform vec3 CellWidth; //Width of every cell
            uniform float Dim; //Number of Cells for axis
            uniform float RTDim; //Dimension of the Frambuffer/Texture/Viewport
            uniform int NoB; //Number of Buffers that can handle the video card
            uniform sampler2D newPosition[4];
            uniform mat4 modelViewMatrix;                
            uniform mat4 projectionMatrix;

            attribute vec3 VertPos;

            varying vec3 debug;
            varying vec3 CellColor;

            float rand(vec2 co){
                return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);
            }

            void main(void) {
                vec3 pos;

                //First i take the vertex from the min-max range to the 0-Dim range
                vec3 CellIndex = floor((VertPos - min)*Dim/(max - min));

                if(CellIndex.x == Dim)CellIndex.x--;
                if(CellIndex.y == Dim)CellIndex.y--;
                if(CellIndex.z == Dim)CellIndex.z--;

                //Make the 3D index a 1D index

                float temp = CellIndex.x + CellIndex.y * Dim + CellIndex.z*Dim*Dim ;

                //Make the 1D index a 2D index
                pos.y = floor(temp/RTDim);
                pos.x = temp - (pos.y * RTDim);
                pos.z = 1.0;
                // it seems that the vertex with index 0 are begin culled

                pos.x +=0.1;
                pos.y +=0.1;

                vec3 Textpos = pos / RTDim;
                vec4 result = texture2D( newPosition[0], Textpos.xy);


                //Take from the 0-RTDim range to the -1 - 1 Range
                pos.x = ((pos.x / RTDim)*2.0) - 1.0;
                pos.y = ((pos.y / RTDim)*2.0) - 1.0;


                vec3 CellMin = CellIndex * CellWidth;
                vec3 CellMax = CellMin + CellWidth;
                CellColor = vec3(rand(vec2(CellIndex.x)),
                                rand(vec2(CellIndex.y)),
                                rand(vec2(CellIndex.z)));

                /*

                if( CellMin.x < result.x){
                    result.x = CellMin.x;
                }else{
                    if( result.x < CellMax.x ){
                        result.x = CellMax.x;
                    }
                }

                if( CellMin.y < result.y){
                    result.y = CellMin.y;
                }else{
                    if( result.y < CellMax.y ){
                        result.y = CellMax.y;
                    }
                }

                if( CellMin.z < result.z){
                    result.z = CellMin.z;
                }else{
                    if( result.z < CellMax.z ){
                        result.z = CellMax.z;
                    }
                }

                */
    
                debug = CellIndex.xyz;


                //gl_Position = vec4(pos, 1.0);
                //gl_PointSize = 1.0;      
                gl_Position = projectionMatrix * modelViewMatrix * result;
            }
        `;
        
        this.fragmentPass3 = `
            #extension GL_EXT_draw_buffers : enable
            precision highp float;
            precision highp int;
            uniform int NoB;

            varying vec3 debug;
            varying vec3 CellColor;

            void main(void) {
                //gl_FragData[0] = vec4(0.0,0.0,0.0,1.0);
                gl_FragData[0] = vec4(CellColor,1.0);
            }      
        `;
    }

    initGL() {
        try {
            this.gl = this.canvas.getContext("experimental-webgl");
            this.gl.viewportWidth = this.canvas.width;
            this.gl.viewportHeight = this.canvas.height;
        } catch (e) {
            alert("Error "+e);
        }
        return this.gl;
    }

    initTextureFramebuffer() {
        var gl = this.gl;
        this.ext = gl.getExtension("WEBGL_draw_buffers");
        this.NoB = gl.getParameter(this.ext.MAX_DRAW_BUFFERS_WEBGL);
        this.NoB = 4;
        this.Fbuffer = gl.createFramebuffer();
        gl.blendEquation(gl.FUNC_ADD);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.enable(gl.BLEND);
        this.Fbuffer.width = this.RTDim;
        this.Fbuffer.height = this.RTDim;
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.bindRenderbuffer(gl.RENDERBUFFER, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    setTextureBuffer(texts){
        var gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.Fbuffer);
        var Textures = [];
        var bufs = [];

        for(var i=0; i< this.NoB; i++){
            Textures[i] = new THREE.Texture();
            Textures[i].__webglTexture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, Textures[i].__webglTexture );
            Textures[i].__webglInit = false;
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texImage2D(
                gl.TEXTURE_2D, 
                0, 
                gl.RGBA, 
                this.RTDim, 
                this.RTDim, 
                0, 
                gl.RGBA, 
                gl.FLOAT, 
                null
            ); 
            bufs[i] = this.ext.COLOR_ATTACHMENT0_WEBGL + i;
            gl.framebufferTexture2D(
                gl.FRAMEBUFFER, bufs[i],
                gl.TEXTURE_2D,
                Textures[i].__webglTexture,
                0
            );
        }
        this.ext.drawBuffersWEBGL(bufs);
        Textures.forEach(function(entry){
            texts.push(entry);
        });
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.bindRenderbuffer(gl.RENDERBUFFER, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    
    RemoveMesh(name){
        var selectedObject = this.sceneRTT.getObjectByName(name);
        this.sceneRTT.remove( selectedObject );
    }

    resize(){
        this.WIDTH = window.innerWidth/2;
        this.HEIGHT = window.innerHeight;
        this.cam.aspect = this.WIDTH / this.HEIGHT;
        this.cam.updateProjectionMatrix();
        this.renderer.setSize( this.WIDTH, this.HEIGHT );
    }

    load(Modelo,simplify=false){
        var loader = null
        var ext = Modelo.split(".").last()
        var manager = new THREE.LoadingManager();

        manager.onProgress = function ( item, loaded, total ) {
            console.log( item, loaded, total );
        };

        var onProgress = function ( xhr ) {
            if ( xhr.lengthComputable ) {
                var percentComplete = xhr.loaded / xhr.total * 100;
                console.log( Math.round(percentComplete, 2) + '% downloaded' );
            }
        };

        var onError = function ( xhr ) {
        };

        if(ext == "js" || ext == "json"){
            loader = new THREE.JSONLoader();

        }else if(ext == "obj"){
            loader = new THREE.OBJLoader(manager);
            this.obj = true;
        }
        var url = this.static+"files/"+Modelo;
        var Mesh = null
        this.Simplify = simplify;
        loader.load(url,this.cargarModelo.bind(this));
    }

    cargarModelo(object){
        TD = document.getElementById("dimension").value; // Dimensiones
        var Dim;
        if(TD != "" && 0 < TD && TD < 40 ){
            Dim = TD;
        }

        if(this.obj){
            var geometry = null
            object.traverse(function (child) {
                if (child instanceof THREE.Mesh) {
                    geometry =  child.geometry;
                }
            });

            this.geometry = geometry;
        }else{
            this.geometry = new THREE.BufferGeometry().fromGeometry( object );
        }

        var geo = this.geometry;

        geo.computeBoundingBox();

        this.min = geo.boundingBox.min;
        this.max = geo.boundingBox.max;

        this.max.sub(this.min);

        var maxRange = 1/MaxInVector( this.max);

        var minusMin = this.min.clone()
        minusMin.multiplyScalar(-1.0);
        geo.translate(minusMin.x,minusMin.y,minusMin.z);
        geo.scale(maxRange,maxRange,maxRange);
        geo.translate(1.0,1.0,1.0);

        geo.verticesNeedUpdate = true;
        this.min = geo.boundingBox.min;
        this.max = geo.boundingBox.max;

        this.CellWidth = this.max.clone();
        this.CellWidth.sub(this.min);
        this.CellWidth.divideScalar(this.Dim);
        
        var pos = geo.attributes.position;
        this.gridHelper = new THREE.GridBoxHelper( this.min, this.max, this.CellWidth );
        this.scene.add( this.gridHelper );

        if (this.Simplify){
            this.MeshSimplify();         
            this.Simplify = false;
        }else{       
            var Mesh;
            var mat = new THREE.MeshPhongMaterial( {
                color: 0xff0000,
                polygonOffset: true,
                polygonOffsetFactor: 1, // positive value pushes polygon further away
                polygonOffsetUnits: 1
            } );
            Mesh = new THREE.Mesh(this.geometry,mat);
            Mesh.scale.x = Mesh.scale.y = Mesh.scale.z = 1;
            Mesh.castShadow = true;
            Mesh.receiveShadow = true;
            Mesh.name = this.meshID.toString();
            this.meshID +=1 ;
            this.scene.add(Mesh);
            var geom = new THREE.EdgesGeometry( geo, 0.0 ); // or WireframeGeometry
            var mat = new THREE.LineBasicMaterial( { color: 0xffffff, linewidth: 2 } );
            this.wireframe = new THREE.LineSegments( geom, mat );
            Mesh.add( this.wireframe );
        }
        this.animate();
    }

    stepOne(){
        var gl = this.gl;       
        var geo = this.geometry;
        var len = geo.attributes.position.count;
        var VB = new THREE.Float32Attribute(len * 3,3);
        var VC = new THREE.Float32Attribute(len * 3,3);
        var VA = new THREE.Float32Attribute(len * 3,3);
        var VDraw = new THREE.Float32Attribute(len,1);
        var pos = geo.attributes.position;
        console.log(pos.array);
        var indexA = 0;
        var indexB = 0;
        var indexC = 0;
        var Vertices = [];

        for(var i=0; i<20;i++){
            Vertices.push(i)
        }
        var tempRange = this.max.clone();
        tempRange.sub(this.min);

        for(var i=0;i<len;i++){
            if(i%3==0){
                indexA = i;
                indexB = i+1;
                indexC = i+2;
            }

            VA.copyAt(i,pos,indexA);
            VB.copyAt(i,pos,indexB);
            VC.copyAt(i,pos,indexC);

            if(Vertices.includes(i)){
                VDraw.setX(i,1.0); 
            }else{
                VDraw.setX(i,0.0); 
            }
            
            var verPos = new THREE.Vector3();
            verPos.fromArray(pos.array,i*3);
            verPos.sub(this.min);
            verPos.multiplyScalar(this.Dim);
            verPos.divide(tempRange);
            verPos.floor();
            //console.log(verPos);
        }

        geo.addAttribute( 'VB',  VB );
        geo.addAttribute( 'VC',  VC );
        geo.addAttribute( 'VA',  VA );
        geo.addAttribute( 'VDraw',  VDraw );
        geo.addAttribute( 'VertPos',  pos );

        var rttmat = new THREE.RawShaderMaterial( {
            uniforms: {
                max:{ type:'v3',value:this.max},
                min:{ type:'v3',value:this.min},
                NoB:{ type:'i',value:this.NoB},
                Dim:{ type:'f',value:this.Dim},
                RTDim:{ type:'f',value:this.RTDim}
            },
            vertexShader: this.vertexPass1,
            fragmentShader: this.fragmentPass1,
            transparent : true,
            side: THREE.DoubleSide
        });
        rttmat.blending = THREE.AdditiveBlending;
        var mesh = new THREE.Points(geo,rttmat);
        mesh.name = "Simplificado"
        this.sceneRTT.add(mesh);
        this.renderer.setSize(this.RTDim,this.RTDim);
        this.Pass1Result = []; 
        this.setTextureBuffer(this.Pass1Result);
        gl.bindFramebuffer(gl.FRAMEBUFFER,this.Fbuffer); 
        this.renderer.clear();
        this.renderer.render( this.sceneRTT, this.camRTT );
        gl.bindFramebuffer(gl.FRAMEBUFFER,null) 
        this.renderer.setSize(this.WIDTH, this.HEIGHT);
        this.RemoveMesh("Simplificado");
    }

    stepTwo(){
        var gl = this.gl;
        var plane = new THREE.PlaneBufferGeometry( this.RTDim, this.RTDim );

        var pass2mat = new THREE.RawShaderMaterial({
            uniforms: {
                quadricError: { type:'tv', value: this.Pass1Result},
                CellWidth:{ type:'v3',value:this.CellWidth},
                max:{ type:'v3',value:this.max},
                min:{ type:'v3',value:this.min},
                NoB:{ type:'i',value:this.NoB},
                Dim:{ type:'f',value:this.Dim},
                RTDim:{ type:'f',value:this.RTDim}
            },
            vertexShader: this.vertexPass2,
            fragmentShader: this.fragmentPass2
        });

        var Mesh = new THREE.Mesh(plane,pass2mat);
        Mesh.name = "Plano"
        this.sceneRTT.add(Mesh);
        this.renderer.setSize(this.RTDim,this.RTDim);
        this.Pass2Result = [];
        this.setTextureBuffer(this.Pass2Result);
        gl.bindFramebuffer(gl.FRAMEBUFFER,this.Fbuffer); 
        this.renderer.clear();
        this.renderer.render( this.sceneRTT, this.camRTT );

        gl.bindFramebuffer(gl.FRAMEBUFFER,null) 
        this.renderer.setSize(this.WIDTH, this.HEIGHT);
        this.RemoveMesh("Plano");
    }

    stepThree(){
        /*
        Se tiene que enviar de nuevo la malla original
        y las coordenadas representaste de cada celda
        para reubicar los vertices pertenecientes a una celda
        a su nueva posicion.
        */
        var gl = this.gl;

        var geo =  this.geometry ;
        
        var pos = geo.attributes.position;

        var len = geo.attributes.position.count;
        
        var Move = new THREE.Float32Attribute(len,1);

        geo.addAttribute( 'VertPos',  pos );
        geo.addAttribute( 'Move',  Move );

        var mat = new THREE.RawShaderMaterial( {
            uniforms: {
                newPosition: { type: 'tv', value: this.Pass2Result},
                max:{ type:'v3',value:this.max},
                min:{ type:'v3',value:this.min},
                CellWidth:{ type:'v3',value:this.CellWidth},
                NoB:{ type:'i',value:this.NoB},
                Dim:{ type:'f',value:this.Dim},
                RTDim:{ type:'f',value:this.RTDim}
            },
            vertexShader: this.vertexPass3,
            fragmentShader: this.fragmentPass3,
            side: THREE.DoubleSide
        });

        var mesh = new THREE.Mesh(geo,mat);
        mesh.name = "Paso3" 
        var geom = new THREE.EdgesGeometry( geo, 0.0 ); // or WireframeGeometry
        var mate = new THREE.LineBasicMaterial( { color: 0xffffff, linewidth: 2 } );
        this.wireframe = new THREE.LineLoop( geo,mat );
        this.scene.add( this.wireframe );

        this.scene.add(mesh);    


        var mesh2 = new THREE.Points(geo,mat);

        mesh2.name = "Simplificado"
        this.sceneRTT.add(mesh2);
        this.renderer.setSize(this.RTDim,this.RTDim);
        this.Pass3Result = []; 
        this.setTextureBuffer(this.Pass3Result);
        gl.bindFramebuffer(gl.FRAMEBUFFER,this.Fbuffer); 
        this.renderer.clear();
        this.renderer.render( this.sceneRTT, this.camRTT );
        gl.bindFramebuffer(gl.FRAMEBUFFER,null) 
        this.renderer.setSize(this.WIDTH, this.HEIGHT);
        this.RemoveMesh("Simplificado");
    }

    MeshSimplify(){
        this.stepOne();

        this.stepTwo();

        this.stepThree();

        var showZeros = true;

        var gl = this.gl;
        var size = this.RTDim * this.RTDim * 4;
        var framebuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        var indexPass = 1;
        this.Pass1Result.forEach(function(entry){
            var pixels = new Float32Array(size);
            //Codigo para imprimir en consola el resultado del paso 1
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, 
                gl.TEXTURE_2D, entry.__webglTexture, 0);
            gl.readPixels(0, 0, this.RTDim, this.RTDim, gl.RGBA,
                 gl.FLOAT, pixels);
            if(indexPass==4){
                var total= 0.0;
                pixels.forEach(function(entry){
                    total+=entry;
                }.bind(this));
                console.log("total de caras sumadas:"+total);
            }
            if(showZeros){
                console.log("Paso 1, textura :" + indexPass++);
                console.log(pixels);
            }else{            
                var Nonzero = [];
                pixels.forEach(function(entry){
                    if(entry != 0 ){
                        Nonzero.push(entry)
                    }
                }.bind(this));
                if(Nonzero.length > 0 ){
                    console.log("Paso 1, textura :" + indexPass++);
                    console.log(Nonzero);
                    }
            }

            //Codigo para imprimir en consola el resultado del paso 1

        }.bind(this));      

        indexPass = 1;  
        this.Pass2Result.forEach(function(entry){
            var pixels = new Float32Array(size);
            //Codigo para imprimir en consola el resultado del paso 1
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, 
                gl.TEXTURE_2D, entry.__webglTexture, 0);
            gl.readPixels(0, 0, this.RTDim, this.RTDim, gl.RGBA,
                 gl.FLOAT, pixels);
            var Nonzero = [];
            pixels.forEach(function(entry){
                if(entry != 0){
                    Nonzero.push(entry)
                }
            }.bind(this));
            if(showZeros){
                console.log("Paso 2, textura :" + indexPass++);
                console.log(pixels);
            }else{            
                var Nonzero = [];
                pixels.forEach(function(entry){
                    if(entry != 0 ){
                        Nonzero.push(entry)
                    }
                }.bind(this));
                if(Nonzero.length > 0 ){
                    console.log("Paso 2, textura :" + indexPass++);
                    console.log(Nonzero);
                    }
            }
            //Codigo para imprimir en consola el resultado del paso 1

        }.bind(this));

        indexPass = 1;  
        this.Pass3Result.forEach(function(entry){
            var pixels = new Float32Array(size);
            //Codigo para imprimir en consola el resultado del paso 1
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, 
                gl.TEXTURE_2D, entry.__webglTexture, 0);
            gl.readPixels(0, 0, this.RTDim, this.RTDim, gl.RGBA,
                 gl.FLOAT, pixels);
            var Nonzero = [];
            pixels.forEach(function(entry){
                if(entry != 0){
                    Nonzero.push(entry)
                }
            }.bind(this));
            if(showZeros){
                console.log("Paso 3, textura :" + indexPass++);
                console.log(pixels);
            }else{            
                var Nonzero = [];
                pixels.forEach(function(entry){
                    if(entry != 0 ){
                        Nonzero.push(entry)
                    }
                }.bind(this));
                if(Nonzero.length > 0 ){
                    console.log("Paso 3, textura :" + indexPass++);
                    console.log(Nonzero);
                }
            }
            //Codigo para imprimir en consola el resultado del paso 1

        }.bind(this));

    }

    animate() {
        requestAnimationFrame( this.animate.bind(this) );
        this.stats.update();
        this.renderer.clear();
        if (typeof this.wireframe !== 'undefined')this.wireframe.visible = document.getElementById("wireframe").value;
        if (typeof this.gridHelper !== 'undefined')this.gridHelper.visible = document.getElementById("gridbox").value;
        this.renderer.render( this.scene, this.cam );
        this.controls.update();
        document.getElementById("CameraX").value = this.controls.object.position.x;
        document.getElementById("CameraY").value = this.controls.object.position.y;
        document.getElementById("CameraZ").value = this.controls.object.position.z;
    }

    Cargarscenerio(){
        this.scene.fog = new THREE.Fog( 0xffffff, 1, 300 );
        this.scene.fog.color.setHSL( 0.6, 0, 1 );
        this.hemiLight = new THREE.HemisphereLight( 0xffffff, 0xffffff, 0.6 );
        this.hemiLight.color.setHSL( 0.6, 1, 0.6 );
        this.hemiLight.groundColor.setHSL( 0.095, 1, 0.75 );
        this.hemiLight.position.set( 0, 500, 0 );
        this.scene.add( this.hemiLight );
        this.spotlight = new THREE.SpotLight(0xffffff,1,500,-45,10);
        this.spotlight.position.set(0,100,50);
        var spotTarget = new THREE.Object3D();
        spotTarget.position.set(0, 100,50);
        this.spotlight.target = spotTarget;
        this.scene.add(this.spotlight);
        this.scene.add(new THREE.PointLightHelper(this.spotlight, 1));
        this.spotlight.castShadow = true;
        this.spotlight.shadowMapSizeWidth = 2048;
        this.spotlight.shadowMapSizeHeight = 2048;
        var d = 50;
        this.spotlight.shadowcamLeft = -d;
        this.spotlight.shadowcamRight = d;
        this.spotlight.shadowcamTop = d;
        this.spotlight.shadowcamBottom = -d;
        this.spotlight.shadowcamFar = 3500;
        this.spotlight.shadowBias = -0.0001;
        this.spotlight.shadowDarkness = 0.35;
        var groundGeo = new THREE.PlaneBufferGeometry( 500, 500 );
        var groundMat = new THREE.MeshPhongMaterial( { color: 0xffffff, specular: 0x050505 } );
        groundMat.color.setHSL( 0.095, 1, 0.75 );
        var ground = new THREE.Mesh( groundGeo, groundMat );
        ground.rotation.x = -Math.PI/2;
        ground.position.y = -5;
        ground.receiveShadow = true;
        //this.scene.add(ground);
        var uniforms = {
            topColor:    { type: "c", value: new THREE.Color( 0x0077ff ) },
            bottomColor: { type: "c", value: new THREE.Color( 0x0077ff ) },
            offset:      { type: "f", value: 33 },
            exponent:    { type: "f", value: 0.6 }
        };
        uniforms.topColor.value.copy( this.hemiLight.color );
        this.scene.fog.color.copy( uniforms.bottomColor.value );
        var skyGeo = new THREE.SphereGeometry( 4000, 32, 15 );
        var skyMat = new THREE.ShaderMaterial( { vertexShader: this.matVertShader, fragmentShader: this.matFragShader, uniforms: uniforms, side: THREE.BackSide } );
        var sky = new THREE.Mesh( skyGeo, skyMat );
        this.scene.add( sky );
    }   
}


var webgl = null;
var webgl2 = null;

function WebglStart() {
    TD = document.getElementById("dimension").value; // Dimensiones
    var Dim;
    if(TD != "" && 0 < TD && TD < 40 ){
        Dim = parseInt(TD);
    }

    cubic = ownCubic(Dim);

    sqrt = Math.sqrt(cubic);

    var RTDim = Math.ceil(sqrt);


    obj = "treehouse_logo.js"
    //obj = "dodecahedron.json"
    //obj = "tetrahedron-3d-shape.json"
    //obj = "dodecahedron.obj"
    //obj = "dodeca.obj"
    //obj = "tetrahedron.obj"
    //obj = "male02.obj"

    webgl = new WebGl("Original",Dim,RTDim);
    webgl2 = new WebGl("Simplificado",Dim,RTDim);
    webgl.load(obj);
    webgl2.load(obj,true);
}    

document.getElementById("cargar").onclick = function(){
    webgl = new WebGl("Original",Dim,RTDim);
    
    webgl2 = new WebGl("Simplificado",Dim,RTDim);
    var File = document.getElementById("cargar").value;
    var path = File.split("\\");
    var Last = path[path.length - 1];
    if(File){
        webgl.load(Last);
        webgl2.load(Last,true);
    }
}