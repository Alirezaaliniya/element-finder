<?php
/**
 * Prints the saved Elementor data of the given documents as JSON:
 *   { "<postId>": { "elements": [...], "settings": {...} } }
 * Ground truth for tools/e2e/fidelity.mjs.
 *
 * Usage: php elementor-data.php <wp-root> <postId> [<postId>...]
 */
if ( PHP_SAPI !== 'cli' ) {
	exit( 'CLI only' );
}
$wp_root = rtrim( $argv[1] ?? '', '/\\' );
$_SERVER['HTTP_HOST'] = 'localhost';
$_SERVER['REQUEST_URI'] = '/';
define( 'WP_USE_THEMES', false );
require $wp_root . '/wp-load.php';

$out = [];
foreach ( array_slice( $argv, 2 ) as $id ) {
	$id = (int) $id;
	$raw = get_post_meta( $id, '_elementor_data', true );
	$elements = is_string( $raw ) ? json_decode( $raw, true ) : $raw;
	$out[ $id ] = [
		'elements' => is_array( $elements ) ? $elements : [],
		'settings' => get_post_meta( $id, '_elementor_page_settings', true ) ?: new stdClass(),
	];
}
echo wp_json_encode( $out, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
