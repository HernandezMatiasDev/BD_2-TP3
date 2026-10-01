use red_social_tp3;

db.usuarios.find({ seguidores: { $gte: 500, $lte: 2000 } });
