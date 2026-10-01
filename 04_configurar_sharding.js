use red_social_tp3;

sh.enableSharding("red_social_tp3");

sh.shardCollection("red_social_tp3.usuarios", { _id: "hashed" });

sh.shardCollection("red_social_tp3.publicaciones", { autor_id: "hashed" });

sh.shardCollection("red_social_tp3.comentarios", { publicacion_id: "hashed" });

sh.shardCollection("red_social_tp3.historias", { _id: "hashed" });

db.historias.createIndex({ "fecha_creacion": 1 }, { expireAfterSeconds: 86400 });