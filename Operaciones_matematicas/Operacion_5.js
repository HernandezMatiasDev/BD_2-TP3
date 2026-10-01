use red_social_tp3;

db.publicaciones.updateMany(
  { promocionada: true },
  { $mul: { alcance: 2 } }
);