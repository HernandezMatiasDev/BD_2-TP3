use red_social_tp3;

let nuevoComentarioId = new ObjectId();

db.comentarios.insertOne({ 
  _id: nuevoComentarioId,
  publicacion_id: ObjectId('6abd63f329d70067564c8181'), 
  autor_id:  ObjectId('6abd63f129d70067564c3ddf'),
  autor: "Lihuen", 
  texto: "Esta re bueno", 
  fecha: new Date() 
});

db.publicaciones.updateOne(
  { _id: ObjectId('6abd63f329d70067564c8181')}, 
  { 
    $push: { 
      comentarios_recientes: { 
        $each: [{ 
          comentario_id: nuevoComentarioId, 
          autor_id: ObjectId('6abd63f129d70067564c3ddf'),
          autor: "Lihuen", 
          texto: "Esta re bueno" 
        }],
        $position: 0, 
        $slice: 3
      } 
    },
    $inc: { comentarios_totales: 1 }
  }
);