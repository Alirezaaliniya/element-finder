<?php
namespace ElementorPro\Modules\AtomicForm\Actions;

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly
}

class Action_Type {
	const EMAIL = 'email';
	const COLLECT_SUBMISSIONS = 'collect-submissions';
	const WEBHOOK = 'webhook';

	/**
	 * Get all registered action types.
	 *
	 * @return array
	 */
	public static function get_all_types(): array {
		return [
			self::EMAIL,
			self::COLLECT_SUBMISSIONS,
			self::WEBHOOK,
		];
	}

	/**
	 * Check if an action type is valid.
	 *
	 * @param string $type Action type to validate.
	 * @return bool
	 */
	public static function is_valid( string $type ): bool {
		return in_array( $type, self::get_all_types(), true );
	}
}
