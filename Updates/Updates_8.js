use red_social_tp3;

db.usuarios.updateOne(
  {_id: ObjectId('6abd63f129d70067564c3d52')}, 
  { $set: { ciudad: "Rosario" } }
);