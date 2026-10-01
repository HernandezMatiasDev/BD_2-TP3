use red_social_tp3;


let u1 = new ObjectId(); let u2 = new ObjectId(); let u3 = new ObjectId(); let u4 = new ObjectId(); let u5 = new ObjectId();
let p1 = new ObjectId(); let p2 = new ObjectId(); let p3 = new ObjectId(); let p4 = new ObjectId(); let p5 = new ObjectId();
let p6 = new ObjectId(); let p7 = new ObjectId(); let p8 = new ObjectId(); let p9 = new ObjectId(); let p10 = new ObjectId();

let c1 = new ObjectId(); let c2 = new ObjectId(); let c3 = new ObjectId(); let c4 = new ObjectId(); let c5 = new ObjectId();
let c6 = new ObjectId(); let c7 = new ObjectId(); let c8 = new ObjectId(); let c9 = new ObjectId(); let c10 = new ObjectId();
let c11 = new ObjectId(); let c12 = new ObjectId(); let c13 = new ObjectId(); let c14 = new ObjectId(); let c15 = new ObjectId();

db.usuarios.insertMany([
  { _id: u1, nombre: "Juan", edad: 25, ciudad: "Buenos Aires", biografia: "Dev", seguidores: 1500, creditos_virtuales: 1000 },
  { _id: u2, nombre: "Mika", edad: 22, ciudad: "Quilmes", biografia: "Diseñadora", seguidores: 800, creditos_virtuales: 500 },
  { _id: u3, nombre: "Damián", edad: 17, ciudad: "Buenos Aires", biografia: "Gamer", seguidores: 3000, creditos_virtuales: 200 },
  { _id: u4, nombre: "Lihuen", edad: 23, ciudad: "Córdoba", biografia: "Fotógrafo", seguidores: 600, creditos_virtuales: 0 },
  { _id: u5, nombre: "Ana", edad: 30, ciudad: "Rosario", biografia: "Lectora", seguidores: 150, creditos_virtuales: 5000 }
]);

db.publicaciones.insertMany([
  { _id: p1, autor_id: u1, nombre_autor: "Juan", contenido: "Mi primer cluster distribuido", likes: 120, comentarios_totales: 5, hashtags: ["mongodb", "backend"], fecha: new Date(),
    comentarios_recientes: [
      { comentario_id: c5, autor_id: u2, autor: "Mika", texto: "Genial, funcionó" }, 
      { comentario_id: c4, autor_id: u5, autor: "Ana", texto: "Me sirve el dato" }, 
      { comentario_id: c3, autor_id: u3, autor: "Damián", texto: "Top" }
    ] 
  },
  { _id: p2, autor_id: u1, nombre_autor: "Juan", contenido: "Patrones de diseño en NoSQL", likes: 80, comentarios_totales: 0, hashtags: ["arquitectura"], fecha: new Date(), comentarios_recientes: [] },
  { _id: p3, autor_id: u1, nombre_autor: "Juan", contenido: "Probando queries avanzadas", likes: 550, comentarios_totales: 4, hashtags: ["mongodb"], fecha: new Date(),
    comentarios_recientes: [
      { comentario_id: c9, autor_id: u5, autor: "Ana", texto: "Sirve mucho" }, 
      { comentario_id: c8, autor_id: u2, autor: "Mika", texto: "Me copio el código" }, 
      { comentario_id: c7, autor_id: u4, autor: "Lihuen", texto: "Buena query" }
    ] 
  },
  { _id: p4, autor_id: u2, nombre_autor: "Mika", contenido: "Nuevo diseño de logo terminado", likes: 300, comentarios_totales: 3, hashtags: ["design"], fecha: new Date(),
    comentarios_recientes: [
      { comentario_id: c12, autor_id: u4, autor: "Lihuen", texto: "Tremendo" }, 
      { comentario_id: c11, autor_id: u5, autor: "Ana", texto: "Me encanta el color" }, 
      { comentario_id: c10, autor_id: u1, autor: "Juan", texto: "Muy lindo" }
    ] 
  },
  { _id: p5, autor_id: u2, nombre_autor: "Mika", contenido: "Rutina de calistenia completada", likes: 45, comentarios_totales: 0, hashtags: ["gym", "calistenia"], fecha: new Date(), comentarios_recientes: [] },
  { _id: p6, autor_id: u3, nombre_autor: "Damián", contenido: "Server de ARK listo para jugar", likes: 15, comentarios_totales: 2, hashtags: ["gaming", "ark"], fecha: new Date(),
    comentarios_recientes: [
      { comentario_id: c14, autor_id: u2, autor: "Mika", texto: "Sale un pvp" }, 
      { comentario_id: c13, autor_id: u1, autor: "Juan", texto: "Pasa IP" }
    ] 
  },
  { _id: p7, autor_id: u3, nombre_autor: "Damián", contenido: "Victoria en LoL en la última partida", likes: 90, comentarios_totales: 0, hashtags: ["lol"], fecha: new Date(), comentarios_recientes: [] },
  { _id: p8, autor_id: u4, nombre_autor: "Lihuen", contenido: "Fotos del centro de la ciudad", likes: 200, comentarios_totales: 1, hashtags: ["fotografia"], fecha: new Date(),
    comentarios_recientes: [
      { comentario_id: c15, autor_id: u3, autor: "Damián", texto: "Alta foto" }
    ] 
  },
  { _id: p9, autor_id: u5, nombre_autor: "Ana", contenido: "Terminé el libro de ciencia ficción, muy recomendado", likes: 60, comentarios_totales: 0, hashtags: ["libros"], fecha: new Date(), comentarios_recientes: [] },
  { _id: p10, autor_id: u5, nombre_autor: "Ana", contenido: "Buscando recetas veganas y sin TACC", likes: 10, comentarios_totales: 0, hashtags: ["vegan", "sintacc", "food"], fecha: new Date(), comentarios_recientes: [] }
]);

db.comentarios.insertMany([
  // 5 comentarios para la publicación p1
  { _id: c1, publicacion_id: p1, autor_id: u5, autor: "Ana", texto: "Qué buena onda!", fecha: new Date("2026-09-27T10:00:00Z") },
  { _id: c2, publicacion_id: p1, autor_id: u4, autor: "Lihuen", texto: "Felicidades por el despliegue", fecha: new Date("2026-09-27T10:15:00Z") },
  { _id: c3, publicacion_id: p1, autor_id: u3, autor: "Damián", texto: "Top", fecha: new Date("2026-09-27T10:30:00Z") },
  { _id: c4, publicacion_id: p1, autor_id: u5, autor: "Ana", texto: "Me sirve el dato", fecha: new Date("2026-09-27T10:45:00Z") },
  { _id: c5, publicacion_id: p1, autor_id: u2, autor: "Mika", texto: "Genial, funcionó", fecha: new Date("2026-09-27T11:00:00Z") },

  { _id: c6, publicacion_id: p3, autor_id: u3, autor: "Damián", texto: "Cuidado con los índices, pueden consumir mucha RAM", fecha: new Date("2026-09-27T12:00:00Z") },
  { _id: c7, publicacion_id: p3, autor_id: u4, autor: "Lihuen", texto: "Buena query", fecha: new Date("2026-09-27T12:15:00Z") },
  { _id: c8, publicacion_id: p3, autor_id: u2, autor: "Mika", texto: "Me copio el código", fecha: new Date("2026-09-27T12:30:00Z") },
  { _id: c9, publicacion_id: p3, autor_id: u5, autor: "Ana", texto: "Sirve mucho", fecha: new Date("2026-09-27T12:45:00Z") },

  { _id: c10, publicacion_id: p4, autor_id: u1, autor: "Juan", texto: "Muy lindo", fecha: new Date("2026-09-27T13:00:00Z") },
  { _id: c11, publicacion_id: p4, autor_id: u5, autor: "Ana", texto: "Me encanta el color", fecha: new Date("2026-09-27T13:10:00Z") },
  { _id: c12, publicacion_id: p4, autor_id: u4, autor: "Lihuen", texto: "Tremendo", fecha: new Date("2026-09-27T13:20:00Z") },

  { _id: c13, publicacion_id: p6, autor_id: u1, autor: "Juan", texto: "Pasa IP", fecha: new Date("2026-09-27T14:00:00Z") },
  { _id: c14, publicacion_id: p6, autor_id: u2, autor: "Mika", texto: "Sale un pvp", fecha: new Date("2026-09-27T14:15:00Z") },

  { _id: c15, publicacion_id: p8, autor_id: u3, autor: "Damián", texto: "Alta foto", fecha: new Date("2026-09-27T15:00:00Z") }
]);

db.historias.insertMany([
  { autor_id: u1, nombre_autor: "Juan", url: "https://cdn.redsocial.com/img1.jpg", visualizaciones: 50, fecha_creacion: new Date() },
  { autor_id: u2, nombre_autor: "Mika", url: "https://cdn.redsocial.com/img2.jpg", visualizaciones: 150, fecha_creacion: new Date() },
  { autor_id: u3, nombre_autor: "Damián", url: "https://cdn.redsocial.com/img3.jpg", visualizaciones: 300, fecha_creacion: new Date() },
  { autor_id: u4, nombre_autor: "Lihuen", url: "https://cdn.redsocial.com/img4.jpg", visualizaciones: 20, fecha_creacion: new Date() },
  { autor_id: u5, nombre_autor: "Ana", url: "https://cdn.redsocial.com/img5.jpg", visualizaciones: 5, fecha_creacion: new Date() }
]);