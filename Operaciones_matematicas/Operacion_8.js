use red_social_tp3;

db.publicaciones.find({
  $expr: {
    $gt: [
      "$likes", 
      { $multiply: ["$comentarios_totales", 3] }
    ]
  }
});