use red_social_tp3;

db.publicaciones.updateOne(
  { _id: ObjectId('6abd63f329d70067564c788c')}, 
  {
    $inc: { likes: 25 },
    $mul: { visualizaciones: 1.05 }
  }
);