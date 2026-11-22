use glib::{prelude::*, Variant};
#[test]
fn string_iteration() {
    let values = ["alpha", "", "日本語", "🧙", "omega"];
    let value = values.to_variant();
    assert_eq!(value.array_iter_str().unwrap().collect::<Vec<_>>(), values);
    assert_eq!(value.array_iter_str().unwrap().rev().collect::<Vec<_>>(), values.into_iter().rev().collect::<Vec<_>>());
    let mut iter = value.array_iter_str().unwrap();
    assert_eq!(iter.next(), Some("alpha"));
    assert_eq!(iter.next_back(), Some("omega"));
    assert_eq!(iter.nth(1), Some("日本語"));
    assert_eq!(iter.nth_back(0), Some("🧙"));
    assert_eq!(iter.next(), None);
    assert_eq!(iter.next_back(), None);
    assert_eq!(value.array_iter_str().unwrap().last(), Some("omega"));
}
#[test]
fn empty_and_bounds() {
    let empty: [&str; 0] = [];
    let value = empty.to_variant();
    assert_eq!(value.array_iter_str().unwrap().next(), None);
    assert_eq!(value.array_iter_str().unwrap().next_back(), None);
    assert_eq!(value.array_iter_str().unwrap().last(), None);
    let value = ["one", "two"].to_variant();
    assert_eq!(value.array_iter_str().unwrap().nth(usize::MAX), None);
    assert_eq!(value.array_iter_str().unwrap().nth_back(usize::MAX), None);
    assert!(42i32.to_variant().array_iter_str().is_err());
}
#[test]
fn ordinary_owned_control() {
    let value = ["one", "日本語"].to_variant();
    let values: Vec<String> = value.iter().map(|x: Variant| x.get::<String>().unwrap()).collect();
    assert_eq!(values, ["one", "日本語"]);
}
