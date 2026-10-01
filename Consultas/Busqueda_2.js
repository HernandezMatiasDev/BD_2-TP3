use red_social_tp3;

db.publicaciones.find({ likes: { $gt: 100 } });