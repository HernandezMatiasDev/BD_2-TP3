use red_social_tp3;

db.usuarios.createIndex({ seguidores: 1 },{ name: "idx_seguidores" });
db.usuarios.createIndex({ edad: 1 },{ name: "idx_edad" });
db.usuarios.createIndex({ ciudad: 1 },{ name: "idx_ciudad" });

db.publicaciones.createIndex({ likes: -1 },{ name: "idx_likes_desc" });
db.publicaciones.createIndex({ fecha: -1 },{ name: "idx_fecha_desc" });
db.publicaciones.createIndex({ hashtags: 1 },{ name: "idx_hashtags" });
db.publicaciones.createIndex({ autor_id: 1, fecha: -1, likes: 1 },{ name: "idx_autor_fecha_likes" });

db.comentarios.createIndex({ publicacion_id: 1, fecha: -1 },{ name: "idx_publicacion_fecha" });