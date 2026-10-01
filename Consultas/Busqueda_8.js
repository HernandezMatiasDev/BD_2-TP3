use red_social_tp3;

db.usuarios.find({}, { nombre: 1, seguidores: 1, ciudad: 1, _id: 0 });