use red_social_tp3;

db.publicaciones.find(
    { $or: [{ likes: { $gt: 500 } }, 
    { comentarios_totales: { $lt: 50 } }] });
