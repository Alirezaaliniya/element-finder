<?php
namespace ElementorPro\Modules\AtomicForm\Classes;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

interface Shortcode_Resolver {
	public function resolve( string $message ): string;
}
