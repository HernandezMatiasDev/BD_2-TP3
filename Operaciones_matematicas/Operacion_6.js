use red_social_tp3;

db.publicaciones.updateMany(
  {},
  [
    {
      $set: {
        interacciones_totales: {
          $sum: [
            "$likes", 
            "$comentarios_totales", 
            { $ifNull: ["$compartidos", 0] }
          ]
        }
      }
    }
  ]
);