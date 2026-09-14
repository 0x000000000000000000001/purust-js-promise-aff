pub fn Test_Main_helloPromise() -> std::rc::Rc<Purs_Promise_Internal::Promise> {
    Purs_Promise_Internal::Promise_Internal_resolve(purust_core::Value::String("Hello".to_owned()))
}
pub fn Test_Main_errPromise() -> std::rc::Rc<Purs_Promise_Internal::Promise> {
    Purs_Promise_Internal::Promise_Internal_reject(Purs_Effect_Exception::Effect_Exception_error("err".to_owned()))
}
pub fn Test_Main_customErrPromise() -> std::rc::Rc<Purs_Promise_Internal::Promise> {
    let mut fields = purust_core::RecordFields::new();
    fields.insert("code".to_owned(), purust_core::Value::String("err".to_owned()));
    Purs_Promise_Internal::Promise_Internal_reject(purust_core::Value::DynamicRecord(perceus_ptr::PerceusPtr::new(fields)))
}
pub fn Test_Main_goodbyePromise() -> std::rc::Rc<Purs_Promise_Internal::Promise> {
    Purs_Promise_Internal::Promise_Internal_reject(purust_core::Value::String("Goodbye".to_owned()))
}
