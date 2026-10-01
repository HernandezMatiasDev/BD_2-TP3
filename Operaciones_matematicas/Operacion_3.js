use red_social_tp3;

db.publicaciones.updateMany(
  { likes: { $lt: 100 } },
  { $mul: { likes: 1.10 } }
);