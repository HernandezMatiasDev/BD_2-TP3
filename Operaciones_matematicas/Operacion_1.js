use red_social_tp3;

db.usuarios.updateOne(
  {_id: ObjectId('6abd63f129d70067564c3dd3')}, 
  { $inc: { creditos_virtuales: 500 } }
);