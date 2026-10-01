// =====================================================================
// insertar_datos_masivos.js
// Carga masiva de datos para simular una red social real sobre el
// cluster sharded (red_social_tp3).
//
// Ejecutar conectado al mongos (router), por ejemplo:
//   docker exec -it basededatos-mongos1-1 mongosh --port 27017 --file /ruta/06_insertar_datos_masivos.js
// o simplemente pegando el contenido en un mongosh conectado al puerto 27017 (HAProxy).
//
// Respeta el mismo diseño documental que 04_configurar_sharding.js y
// 05_insertar_datos.js:
//   - usuarios          -> shard key { _id: "hashed" }
//   - publicaciones      -> shard key { autor_id: "hashed" } (Redundancia + Embedding)
//   - comentarios        -> shard key { publicacion_id: "hashed" } (Referencing / patrón subconjunto)
//   - historias          -> shard key { _id: "hashed" }
// =====================================================================

use red_social_tp3;

// ---------------------------------------------------------------------
// CONFIGURACIÓN (ajustá estos valores según la potencia de tu máquina)
// ---------------------------------------------------------------------
const CONFIG = {
  NUM_USUARIOS: 2000,                 // cantidad de usuarios a generar
  MAX_PUBLICACIONES_POR_USUARIO: 50,  // 0 a 50 publicaciones por usuario
  PROBABILIDAD_VIRAL: 0.005,          // 0.5% de las publicaciones se hacen virales
  PORCENTAJE_USUARIOS_CON_HISTORIAS: 0.4, // 40% de los usuarios suben historias
  MAX_HISTORIAS_POR_USUARIO: 4,
  BATCH_SIZE: 1000                    // tamaño de lote para cada insertMany
};
// Tip: para una prueba rápida, bajá NUM_USUARIOS a 200 y PROBABILIDAD_VIRAL a 0.

// ---------------------------------------------------------------------
// DATOS DE APOYO (pools para generar contenido variado)
// ---------------------------------------------------------------------
const nombresPool = ["Juan","Mika","Damián","Lihuen","Ana","Sofía","Martina","Lucas","Valentina","Mateo",
  "Camila","Tomás","Julieta","Bautista","Renata","Thiago","Catalina","Benjamín","Isabella","Facundo",
  "Agustina","Joaquín","Milagros","Santino","Delfina","Franco","Emilia","Nicolás","Victoria","Ignacio",
  "Guadalupe","Gael","Zoe","Dante","Pilar","Bruno","Lara","Ciro","Abril","Simón"];

const ciudadesPool = ["Buenos Aires","Quilmes","Córdoba","Rosario","Mendoza","La Plata","Mar del Plata",
  "Salta","Tucumán","Neuquén","Bariloche","San Juan","Santa Fe","Resistencia","Posadas"];

const biografiasPool = ["Dev","Diseñadora","Gamer","Fotógrafo","Lectora","Amante de los viajes","Foodie",
  "La música es vida","Emprendedor/a","Estudiante","Artista","Fanático del fitness","Escritor/a",
  "Cinéfilo/a","Amante de los animales"];

const hashtagsPool = ["mongodb","backend","arquitectura","design","gym","gaming","ark","lol","fotografia",
  "libros","vegan","food","viajes","musica","arte","tecnologia","futbol","moda","cocina","mascotas",
  "fitness","cine","emprendimiento","naturaleza","memes"];

const contenidoPool = ["Mi primer cluster andando", "Probando queries nuevas", "Patrones de diseño",
  "Día de playa", "Nuevo proyecto arrancando", "Recomendación del día", "Look de hoy", "Entrenamiento matutino",
  "Receta fácil y rápida", "Viaje pendiente", "Reflexiones random", "Nuevo setup", "Atardecer increíble",
  "Logré terminarlo por fin", "Aprendiendo algo nuevo", "Buenas noticias", "Compartiendo un hallazgo",
  "Random thoughts", "Foto del finde", "Mini update"];

const textosComentarioPool = ["Genial!","Top","Sirve mucho","Buenísimo","No sabía esto","Gran contenido",
  "Me encantó","Wow","Sigue así","Excelente aporte","Totalmente de acuerdo","Jaja buenísimo",
  "Guardado para después","Esto lo necesitaba","Increíble","Qué crack","Subilo en video también",
  "Necesitaba ver esto hoy","10/10","Fan de tu contenido"];

// Tiers de seguidores: la mayoría tiene pocos, unos pocos son "influencers"
const TIERS_SEGUIDORES = [
  { nombre: "influencer", probabilidad: 0.03, min: 20000, max: 500000 },
  { nombre: "popular",    probabilidad: 0.12, min: 2000,  max: 20000  },
  { nombre: "normal",     probabilidad: 0.55, min: 100,   max: 2000   },
  { nombre: "nuevo",      probabilidad: 0.30, min: 0,     max: 100    }
];

// ---------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------
function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randomFloat(min, max) { return Math.random() * (max - min) + min; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function elegirTier() {
  const r = Math.random();
  let acumulado = 0;
  for (const tier of TIERS_SEGUIDORES) {
    acumulado += tier.probabilidad;
    if (r <= acumulado) return tier;
  }
  return TIERS_SEGUIDORES[TIERS_SEGUIDORES.length - 1];
}

// Likes correlacionados con los seguidores del autor (a más seguidores, más likes),
// salvo que la publicación sea viral, en cuyo caso se dispara independientemente del autor.
function calcularLikes(seguidoresAutor, esViral) {
  if (esViral) return randomInt(20000, 250000);
  const base = Math.max(seguidoresAutor, 50);
  const engagement = randomFloat(0.005, 0.08); // 0.5% a 8% de los seguidores
  return Math.max(randomInt(0, 15), Math.round(base * engagement));
}

// Los comentarios se correlacionan con los likes (más likes, más comentarios),
// y también explotan en el caso viral.
function calcularComentariosTotales(likes, esViral) {
  if (esViral) return randomInt(300, 2000);
  const ratio = randomFloat(0.02, 0.12);
  return Math.max(0, Math.round(likes * ratio));
}

function fechaAleatoriaUltimoAnio() {
  return new Date(Date.now() - randomInt(0, 365) * 24 * 60 * 60 * 1000);
}

function fechaAleatoriaUltimos180Dias() {
  return new Date(Date.now() - randomInt(0, 180) * 24 * 60 * 60 * 1000);
}

// ---------------------------------------------------------------------
// PASO 1: USUARIOS
// ---------------------------------------------------------------------
print("Generando usuarios...");

let usuariosBuffer = [];
let usuariosGenerados = []; // solo lo necesario para referenciar después: _id, nombre, seguidores

for (let i = 0; i < CONFIG.NUM_USUARIOS; i++) {
  const tier = elegirTier();
  const seguidores = randomInt(tier.min, tier.max);
  const _id = new ObjectId();
  const nombre = pick(nombresPool);

  usuariosBuffer.push({
    _id,
    nombre,
    edad: randomInt(13, 65),
    ciudad: pick(ciudadesPool),
    biografia: pick(biografiasPool),
    seguidores,
    creditos_virtuales: randomInt(0, 5000)
  });

  usuariosGenerados.push({ _id, nombre, seguidores });

  if (usuariosBuffer.length >= CONFIG.BATCH_SIZE) {
    db.usuarios.insertMany(usuariosBuffer, { ordered: false });
    usuariosBuffer = [];
  }

  if ((i + 1) % 500 === 0) print(`  ...${i + 1} usuarios generados`);
}
if (usuariosBuffer.length) db.usuarios.insertMany(usuariosBuffer, { ordered: false });

print(`✅ ${usuariosGenerados.length} usuarios insertados`);

// ---------------------------------------------------------------------
// PASO 2: PUBLICACIONES + COMENTARIOS (histórico) + COMENTARIOS EMBEBIDOS
// ---------------------------------------------------------------------
print("Generando publicaciones y comentarios...");

let publicacionesBuffer = [];
let comentariosBuffer = [];
let totalPublicaciones = 0;
let totalComentarios = 0;
let totalViral = 0;

function flushPublicaciones() {
  if (publicacionesBuffer.length) {
    db.publicaciones.insertMany(publicacionesBuffer, { ordered: false });
    publicacionesBuffer = [];
  }
}
function flushComentarios() {
  if (comentariosBuffer.length) {
    db.comentarios.insertMany(comentariosBuffer, { ordered: false });
    comentariosBuffer = [];
  }
}

for (let u = 0; u < usuariosGenerados.length; u++) {
  const usuario = usuariosGenerados[u];

  // Distribución sesgada hacia pocas publicaciones (la mayoría postea poco,
  // algunos postean mucho), pero permitiendo 0 a MAX_PUBLICACIONES_POR_USUARIO.
  const cantidadPosts = Math.floor(Math.pow(Math.random(), 2.2) * (CONFIG.MAX_PUBLICACIONES_POR_USUARIO + 1));

  for (let j = 0; j < cantidadPosts; j++) {
    const esViral = Math.random() < CONFIG.PROBABILIDAD_VIRAL;
    const likes = calcularLikes(usuario.seguidores, esViral);
    const comentariosTotales = calcularComentariosTotales(likes, esViral);
    const postId = new ObjectId();

    const cantHashtags = randomInt(1, 3);
    const hashtags = Array.from({ length: cantHashtags }, () => pick(hashtagsPool))
      .filter((v, idx, arr) => arr.indexOf(v) === idx); // sin duplicados

    // Generamos los comentarios históricos (colección aparte, Referencing)
    // y nos quedamos con los últimos 3 para embeberlos en la publicación.
    const ultimosComentarios = [];
    for (let k = 0; k < comentariosTotales; k++) {
      const comentador = pick(usuariosGenerados);
      const texto = pick(textosComentarioPool);
      const fecha = fechaAleatoriaUltimos180Dias();

      const comentarioId = new ObjectId();
      comentariosBuffer.push({
        _id: comentarioId,
        publicacion_id: postId,
        autor_id: comentador._id,   // referencia real al usuario que comentó
        autor: comentador.nombre,   // redundancia para no tener que hacer join al listar comentarios
        texto,
        fecha
      });
      totalComentarios++;

      // El comentario embebido guarda comentario_id (referencia al documento
      // completo en la colección comentarios) y autor_id, así nunca puede
      // quedar un nombre embebido que no corresponda al id real.
      const comentarioEmbebido = { comentario_id: comentarioId, autor_id: comentador._id, autor: comentador.nombre, texto };
      ultimosComentarios.push(comentarioEmbebido);
      if (ultimosComentarios.length > 3) ultimosComentarios.shift(); // solo guardamos los últimos 3

      if (comentariosBuffer.length >= CONFIG.BATCH_SIZE) flushComentarios();
    }

    publicacionesBuffer.push({
      _id: postId,
      autor_id: usuario._id,
      nombre_autor: usuario.nombre,       // Redundancia: evita joins para mostrar el feed
      contenido: pick(contenidoPool),
      likes,
      comentarios_totales: comentariosTotales,
      hashtags,                            // Embedding
      comentarios_recientes: ultimosComentarios, // Embedding (patrón de subconjunto)
      fecha: fechaAleatoriaUltimoAnio()
    });

    totalPublicaciones++;
    if (esViral) totalViral++;

    if (publicacionesBuffer.length >= CONFIG.BATCH_SIZE) flushPublicaciones();
  }

  if ((u + 1) % 500 === 0) {
    print(`  ...procesados ${u + 1}/${usuariosGenerados.length} usuarios | ${totalPublicaciones} publicaciones | ${totalComentarios} comentarios`);
  }
}
flushPublicaciones();
flushComentarios();

print(`✅ ${totalPublicaciones} publicaciones insertadas (${totalViral} virales)`);
print(`✅ ${totalComentarios} comentarios históricos insertados`);

// ---------------------------------------------------------------------
// PASO 3: HISTORIAS
// ---------------------------------------------------------------------
print("Generando historias...");

let historiasBuffer = [];
let totalHistorias = 0;

for (const usuario of usuariosGenerados) {
  if (Math.random() >= CONFIG.PORCENTAJE_USUARIOS_CON_HISTORIAS) continue;

  const cantidad = randomInt(1, CONFIG.MAX_HISTORIAS_POR_USUARIO);
  for (let i = 0; i < cantidad; i++) {
    const base = Math.max(usuario.seguidores, 10);
    const visualizaciones = Math.max(1, Math.round(base * randomFloat(0.01, 0.3)));

    historiasBuffer.push({
      autor_id: usuario._id,
      nombre_autor: usuario.nombre,
      url: `historia_${usuario._id}_${i}.jpg`,
      visualizaciones,
      // Simulamos que se subieron en las últimas 24hs, coherente con el diseño TTL
      fecha_creacion: new Date(Date.now() - randomInt(0, 24) * 60 * 60 * 1000)
    });
    totalHistorias++;

    if (historiasBuffer.length >= CONFIG.BATCH_SIZE) {
      db.historias.insertMany(historiasBuffer, { ordered: false });
      historiasBuffer = [];
    }
  }
}
if (historiasBuffer.length) db.historias.insertMany(historiasBuffer, { ordered: false });

print(`✅ ${totalHistorias} historias insertadas`);

// ---------------------------------------------------------------------
// RESUMEN FINAL
// ---------------------------------------------------------------------
print("=====================================================");
print("CARGA MASIVA FINALIZADA");
print(`Usuarios:      ${usuariosGenerados.length}`);
print(`Publicaciones: ${totalPublicaciones} (viral: ${totalViral})`);
print(`Comentarios:   ${totalComentarios}`);
print(`Historias:     ${totalHistorias}`);
print("=====================================================");
