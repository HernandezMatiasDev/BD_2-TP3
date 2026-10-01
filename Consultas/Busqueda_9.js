use red_social_tp3;

db.publicaciones.find().sort({ likes: -1 }).limit(5);