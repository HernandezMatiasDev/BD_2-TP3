use red_social_tp3;

db.publicaciones.updateMany(
  { reportada: true },
  { $mul: { alcance: 0.85 } }
);