use red_social_tp3;

db.comentarios.deleteOne({_id: ObjectId('6abd63f229d70067564c4a40')});

let ultimos3 = db.comentarios.aggregate([
  { $match: { publicacion_id: ObjectId('6abd63f229d70067564c451f') } },
  { $sort: { fecha: -1 } },
  { $limit: 3 },
  { $project: { _id: 0, comentario_id: "$_id", autor_id: 1, autor: 1, texto: 1 } }
]).toArray();


db.publicaciones.updateOne(
  { _id:ObjectId('6abd63f229d70067564c451f')}, 
  { 
    $set: { comentarios_recientes: ultimos3 },
    $inc: { comentarios_totales: -1 }
  }
);
